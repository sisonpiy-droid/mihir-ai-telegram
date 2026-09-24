# MESA Case 1 — Telegram → Gemini → LinkedIn draft assistant

Meera sends a note to a Telegram bot. The bot sends it to Gemini, along
with [`voice-skill.txt`](voice-skill.txt) (her writing-voice guide). Gemini
scores the idea 0-5, decides whether it's ready to become a LinkedIn post,
and if so drafts it in her voice. The result comes back to the same
Telegram chat as a bracket-metadata card. Meera can reply to that card with
a follow-up (a slash command or plain language) to keep iterating on it.

**The bot never posts to LinkedIn and never auto-publishes anything.** It
only ever sends text back into the Telegram chat. Meera copies, edits, and
posts it herself.

## How it works

```
Telegram message  ->  POST /api/telegram-webhook (Vercel)
                          |
                          |-- verify secret token + allowed chat id
                          |-- is this a reply to one of our own cards?
                          |     yes -> parse it back into (note, card) and
                          |            ask Gemini for a follow-up
                          |     no  -> ask Gemini to score + draft the note
                          |
                       Telegram sendMessage back to the same chat
```

There is no database. "Memory" for follow-ups works by embedding the
original note inside every card the bot sends (the `[SOURCE NOTE: ...]`
line) — replying to a card hands that text straight back to the webhook as
`reply_to_message.text`, which is enough to reconstruct the full state. See
`lib/card.ts`.

| File | Purpose |
|---|---|
| `api/telegram-webhook.ts` | Vercel serverless function, the webhook Telegram calls |
| `lib/telegram.ts` | Minimal Telegram Bot API client (sendMessage + webhook admin) |
| `lib/gemini.ts` | Gemini calls: initial score + draft, and follow-up handling; structured JSON output; the numeric-claim backstop |
| `lib/card.ts` | The bracket-metadata card format: render to text, and parse it back out of a replied-to message |
| `lib/voice-skill.ts` | Reads `voice-skill.txt` at the project root |
| `lib/config.ts` | Reads and validates required environment variables |
| `voice-skill.txt` | Meera's writing-voice instructions, used for every draft |
| `scripts/set-webhook.mjs` | Registers the webhook URL with Telegram |
| `scripts/webhook-info.mjs` | Shows current webhook status |
| `scripts/delete-webhook.mjs` | Removes the webhook (needed before `find-chat-id`) |
| `scripts/find-chat-id.mjs` | Reads pending updates to discover a chat's numeric id |
| `scripts/test-webhook.mts` | Full webhook logic test, stubbed fetch, no network/spend |
| `scripts/live-test.mts` | Real Gemini call against sample notes, no Telegram send |
| `scripts/check-note.mts` | Ad-hoc real Gemini check for one note (+ optional follow-up), prints the rendered card |

## The card format

A ready draft looks like:

```
[STATUS: READY]
[SCORE: 4/5]
[ANGLE: ...]
[HOOK: ...]
[NEWS ANGLE: ... / None available]
[EVIDENCE: ...]
[WHY IT WORKS: ...]
[WARNINGS: ... / None]

Review before posting -- nothing is published automatically.

DRAFT LINKEDIN POST

<the draft>

[SOURCE NOTE: <the original note, verbatim>]
```

A note that isn't ready yet gets a shorter rejection card (`STATUS`,
`SCORE`, `REASON`, `MISSING`, `WHAT WOULD MAKE IT STRONGER`, then the same
`SOURCE NOTE` trailer). A follow-up reply that answers a question rather
than rewriting the draft prepends an `[ANSWER: ...]` block before the
(otherwise unchanged) card.

## Follow-ups

Reply to any card (draft or rejection) with a slash command or plain
language to keep iterating on it — the reply is what tells the bot which
note/draft to use as context:

`/score` `/hooks` `/angle` `/stronger` `/shorter` `/expand` `/objections`
`/takeaway` `/ending` `/personal` `/contrarian` `/check`

or natural language like "give me better hooks", "why is this only a 3?",
"make this more shareable", "what evidence is missing?". Gemini interprets
plain language by the closest matching command's intent (see
`FOLLOWUP_INSTRUCTIONS` in `lib/gemini.ts`). Sending a known command
*without* replying to a card gets a nudge instead of being evaluated as a
brand-new note.

Whenever a follow-up actually rewrites the draft, the score is
recalculated; question-style follow-ups (`/score`, `/hooks`, `/objections`,
`/check`, ...) answer in place and leave the score/draft untouched unless
something genuinely needed fixing.

**Known limitation:** if a card is long enough that Telegram splits it into
multiple messages (over 4096 characters — rare for a single post, but
possible with a long note plus a long draft), replying to a later fragment
won't round-trip cleanly since it won't contain `[STATUS: ...]`. Splitting
prefers a line boundary to reduce the odds of this, but it isn't solved
outright.

## Environment variables

Copy `.env.example` to `.env` for local use. In production, set these in
the Vercel dashboard (Project Settings → Environment Variables) — never
commit a real `.env`.

| Name | Required | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | yes | random string you generate yourself; verifies incoming webhook calls really come from Telegram |
| `TELEGRAM_ALLOWED_CHAT_ID` | yes | only this chat's messages are processed; find it with `npm run telegram:find-chat-id` |
| `GEMINI_API_KEY` | yes | from aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | default `gemini-3.6-flash` |

## First-time setup

```bash
npm install
cp .env.example .env   # then fill it in
```

1. **Find the chat id.** Send the bot any message from the chat (or
   channel) you want it to listen to, then:
   ```bash
   npm run telegram:find-chat-id
   ```
   Copy the printed `chat.id` into `TELEGRAM_ALLOWED_CHAT_ID` in `.env`.

2. **Fill in `voice-skill.txt`** with Meera's real voice/style guide (this
   repo ships with hers already filled in).

3. **Sanity-check locally, no network/spend:**
   ```bash
   npm run typecheck
   npm run test:webhook
   ```

4. **Real Gemini check (reads `.env`, costs a little, sends nothing to
   Telegram):**
   ```bash
   npm run test:live
   ```

## Deploying to Vercel

```bash
npx vercel        # first deploy, follow the prompts
npx vercel --prod
```

Then, in the Vercel dashboard, set the five environment variables above
for the Production environment (and Preview, if you test there too), and
redeploy so the function picks them up.

Finally, point Telegram at the deployed URL:

```bash
npm run telegram:set-webhook -- https://<your-app>.vercel.app/api/telegram-webhook
```

Verify with:

```bash
npm run telegram:webhook-info
```

`voice-skill.txt` ships inside the deployed function bundle via
`vercel.json`'s `includeFiles`. Editing it and redeploying is all it takes
to change the voice going forward.

## Error handling

- Every Telegram/Gemini call is wrapped; on failure the handler tries to
  notify the same chat that something went wrong, and always returns
  `200` to Telegram (a non-2xx makes Telegram retry the same update
  repeatedly).
- Requests without a valid `X-Telegram-Bot-Api-Secret-Token` header are
  rejected with `401` before anything else runs.
- Messages from any chat other than `TELEGRAM_ALLOWED_CHAT_ID` are
  silently ignored (`200`, no reply) so a stranger who finds the bot can't
  spend your Gemini quota or learn anything from it.
- Non-text updates (photos, stickers, edited messages) are ignored.

## Security notes

- Rotate `TELEGRAM_BOT_TOKEN` and `GEMINI_API_KEY` if they're ever
  exposed outside this project (e.g. pasted in a chat log, committed by
  accident).
- `TELEGRAM_WEBHOOK_SECRET` is what stops anyone on the internet from
  POSTing fake updates to your webhook URL and burning your Gemini quota
  — keep it out of version control same as the API keys.
- `TELEGRAM_ALLOWED_CHAT_ID` is a second layer: even a request with a
  valid secret is ignored unless it claims to be from that one chat.
