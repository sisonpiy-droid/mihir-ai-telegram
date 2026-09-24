// Exercises the webhook handler's logic end to end with a stubbed fetch --
// no real Telegram or Gemini calls, no network, no spend. Run with:
//   npm run test:webhook

// Force test values -- run without --env-file, or override whatever a
// loaded .env set, so this test is hermetic regardless of real secrets.
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.TELEGRAM_ALLOWED_CHAT_ID = "12345";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "gemini-test";

let failures = 0;
function assert(condition: unknown, message: string): void {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

const sentMessages: Array<{ chatId: unknown; text: string }> = [];

interface StubCard {
  status: "READY" | "NOT_READY";
  score: number;
  angle?: string | null;
  hook?: string | null;
  news_angle?: string | null;
  evidence_used: string[];
  why_it_works?: string | null;
  warnings: string[];
  draft?: string | null;
  reason?: string | null;
  missing?: string | null;
  stronger_hint?: string | null;
  answer?: string | null;
}

let geminiReply: StubCard = {
  status: "READY",
  score: 4,
  angle: "Label claims vs actual performance",
  hook: "A specific mistake beats a general lesson.",
  news_angle: null,
  evidence_used: [],
  why_it_works: "It's a concrete, specific story with a clear takeaway.",
  warnings: [],
  draft: "This is a stubbed draft post.",
  reason: null,
  missing: null,
  stronger_hint: null,
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (url.includes("generativelanguage.googleapis.com")) {
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply) }] } }],
      }),
      { status: 200 }
    );
  }
  if (url.includes("api.telegram.org")) {
    const body = JSON.parse(init?.body ?? "{}");
    if (url.endsWith("/sendMessage")) {
      sentMessages.push({ chatId: body.chat_id, text: body.text });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
}) as typeof fetch;

// Point at a real, checked-in file so getVoiceSkill() doesn't need a stub.
process.chdir(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

const { default: handler } = await import("../api/telegram-webhook.js");

function makeReq(overrides: Partial<{ method: string; headers: Record<string, string>; body: unknown }>) {
  return {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "test-secret" },
    body: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    send(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function msg(id: number, text: string, replyTo?: { text: string }) {
  return {
    message_id: id,
    chat: { id: 12345, type: "private" },
    date: 0,
    text,
    ...(replyTo ? { reply_to_message: { message_id: id - 1, chat: { id: 12345, type: "private" }, date: 0, text: replyTo.text } } : {}),
  };
}

// 1. Wrong secret token is rejected.
{
  const req = makeReq({ headers: { "x-telegram-bot-api-secret-token": "wrong" } });
  const res = makeRes();
  await handler(req, res);
  assert(res.statusCode === 401, "wrong secret token -> 401");
}

// 2. Message from an unauthorized chat is silently ignored (200, no send).
{
  sentMessages.length = 0;
  const req = makeReq({
    body: { update_id: 1, message: { message_id: 1, chat: { id: 999, type: "private" }, date: 0, text: "hi" } },
  });
  const res = makeRes();
  await handler(req, res);
  assert(res.statusCode === 200, "unauthorized chat -> 200");
  assert(sentMessages.length === 0, "unauthorized chat -> no message sent");
}

// 3. /start from the allowed chat gets a welcome message, no Gemini call.
{
  sentMessages.length = 0;
  const req = makeReq({ body: { update_id: 2, message: msg(2, "/start") } });
  const res = makeRes();
  await handler(req, res);
  assert(res.statusCode === 200, "/start -> 200");
  assert(sentMessages.length === 1 && /Hi Meera/.test(sentMessages[0].text), "/start -> welcome message");
}

// 4. A READY note -> full bracket card sent, with the never-auto-publish
// reminder and no invented-number warning.
let readyCardText = "";
{
  sentMessages.length = 0;
  geminiReply = {
    status: "READY",
    score: 4,
    angle: "Label claims vs actual performance",
    hook: "A specific mistake beats a general lesson.",
    news_angle: null,
    evidence_used: ["23% figure from the note"],
    why_it_works: "Concrete and specific.",
    warnings: [],
    draft: "Stubbed draft body.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 3, message: msg(3, "A real note about a client win.") } });
  const res = makeRes();
  await handler(req, res);
  readyCardText = sentMessages[0]?.text ?? "";
  assert(res.statusCode === 200, "READY note -> 200");
  assert(sentMessages.length === 1 && readyCardText.includes("[STATUS: READY]"), "READY note -> STATUS READY");
  assert(readyCardText.includes("[SCORE: 4/5]"), "READY note -> score shown");
  assert(readyCardText.includes("Stubbed draft body."), "READY note -> draft in card");
  assert(readyCardText.includes("nothing is published automatically"), "READY note -> never-auto-publish reminder present");
  assert(readyCardText.includes("None available"), "READY note -> no news angle shown as unavailable");
  assert(readyCardText.includes("23% figure from the note"), "READY note -> evidence surfaced");
  assert(readyCardText.includes("[WARNINGS: None]"), "READY note -> no warnings");
  assert(readyCardText.includes("[SOURCE NOTE: A real note about a client win.]"), "READY note -> source note embedded");
}

// 5. A NOT_READY note -> rejection card, no draft.
{
  sentMessages.length = 0;
  geminiReply = {
    status: "NOT_READY",
    score: 1,
    angle: null,
    hook: null,
    news_angle: null,
    evidence_used: [],
    why_it_works: null,
    warnings: [],
    draft: null,
    reason: "Too vague, no concrete detail yet.",
    missing: "A specific number or scene.",
    stronger_hint: "Add a real customer example.",
  };
  const req = makeReq({ body: { update_id: 4, message: msg(4, "idk just tired today") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(res.statusCode === 200, "NOT_READY note -> 200");
  assert(text.includes("[STATUS: NOT READY]"), "NOT_READY note -> STATUS NOT READY");
  assert(text.includes("[SCORE: 1/5]"), "NOT_READY note -> score shown");
  assert(!text.includes("DRAFT LINKEDIN POST"), "NOT_READY note -> no draft section");
  assert(text.includes("Add a real customer example."), "NOT_READY note -> stronger hint shown");
}

// 6. Non-text update (e.g. a photo) is ignored.
{
  sentMessages.length = 0;
  const req = makeReq({
    body: { update_id: 5, message: { message_id: 5, chat: { id: 12345, type: "private" }, date: 0 } },
  });
  const res = makeRes();
  await handler(req, res);
  assert(res.statusCode === 200, "non-text update -> 200");
  assert(sentMessages.length === 0, "non-text update -> no message sent");
}

// 7. An invented percentage is flagged even if the model's own warnings
// didn't catch it (code-level backstop, not just prompting).
{
  sentMessages.length = 0;
  geminiReply = {
    status: "READY",
    score: 4,
    angle: "a",
    hook: "h",
    news_angle: null,
    evidence_used: [],
    why_it_works: "w",
    warnings: [],
    draft: "Our 5% niacinamide serum performs differently across seasons.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 6, message: msg(6, "A note that never mentions any percentage at all.") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(text.includes("5%") && /doesn't appear in your original note/.test(text), "invented percentage -> flagged automatically");
}

// 8. A reply to a READY card is treated as a follow-up: prior card is
// parsed and passed to Gemini, response re-rendered with the same source
// note.
{
  sentMessages.length = 0;
  geminiReply = {
    status: "READY",
    score: 5,
    angle: "Label claims vs actual performance",
    hook: "An even sharper hook.",
    news_angle: null,
    evidence_used: ["23% figure from the note"],
    why_it_works: "Now even stronger.",
    warnings: [],
    draft: "A rewritten, stronger draft body.",
    reason: null,
    missing: null,
    stronger_hint: null,
    answer: null,
  };
  const req = makeReq({ body: { update_id: 7, message: msg(7, "/stronger", { text: readyCardText }) } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(res.statusCode === 200, "/stronger reply -> 200");
  assert(text.includes("A rewritten, stronger draft body."), "/stronger reply -> updated draft returned");
  assert(text.includes("[SCORE: 5/5]"), "/stronger reply -> recalculated score returned");
  assert(text.includes("[SOURCE NOTE: A real note about a client win.]"), "/stronger reply -> original source note preserved");
}

// 9. A reply to a READY card with a question-style follow-up surfaces an
// [ANSWER: ...] block while (per the stub) leaving the draft unchanged.
{
  sentMessages.length = 0;
  geminiReply = {
    status: "READY",
    score: 4,
    angle: "Label claims vs actual performance",
    hook: "A specific mistake beats a general lesson.",
    news_angle: null,
    evidence_used: ["23% figure from the note"],
    why_it_works: "Concrete and specific.",
    warnings: [],
    draft: "Stubbed draft body.",
    reason: null,
    missing: null,
    stronger_hint: null,
    answer: "1. A better hook. 2. Another better hook.",
  };
  const req = makeReq({ body: { update_id: 8, message: msg(8, "Give me better hooks", { text: readyCardText }) } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(text.startsWith("[ANSWER: 1. A better hook. 2. Another better hook.]"), "natural-language follow-up -> answer block shown");
  assert(text.includes("[STATUS: READY]"), "natural-language follow-up -> card still echoed");
}

// 10. A bare known slash command with no reply gets a nudge instead of
// being evaluated as a brand-new note.
{
  sentMessages.length = 0;
  const req = makeReq({ body: { update_id: 9, message: msg(9, "/score") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(res.statusCode === 200, "bare /score, no reply -> 200");
  assert(/Reply to the draft/.test(text), "bare /score, no reply -> nudge message");
  assert(!text.includes("[STATUS:"), "bare /score, no reply -> not evaluated as a note");
}

// 11. Replying to a plain, non-card message is treated as a brand-new
// note, not a follow-up.
{
  sentMessages.length = 0;
  geminiReply = {
    status: "READY",
    score: 3,
    angle: "a",
    hook: "h",
    news_angle: null,
    evidence_used: [],
    why_it_works: "w",
    warnings: [],
    draft: "Fresh draft from what looked like a reply.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({
    body: { update_id: 10, message: msg(10, "A brand new substantial note.", { text: "just a plain earlier message, not a card" }) },
  });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(text.includes("Fresh draft from what looked like a reply."), "reply to non-card -> treated as new note");
  assert(text.includes("[SOURCE NOTE: A brand new substantial note.]"), "reply to non-card -> source note is the new message, not the old one");
}

globalThis.fetch = realFetch;

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
