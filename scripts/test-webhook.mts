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
  news_used_indices?: number[];
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

// Controls the news-query-generation Gemini call (separate from the main
// card call above, distinguished by its systemInstruction text).
let geminiQueriesReply: string[] = [];

// Controls what the Google News RSS endpoint returns. Most tests don't
// care about news at all, so the default is an empty (but valid) feed --
// combined with geminiQueriesReply defaulting to [], most tests never even
// reach the RSS fetch (findRelevantNews short-circuits on no queries).
let newsRssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>`;
let newsFetchCount = 0;

function newsItemXml(opts: { title: string; source: string; pubDate: string; link: string; description?: string }): string {
  return `<item><title>${opts.title} - ${opts.source}</title><link>${opts.link}</link><pubDate>${opts.pubDate}</pubDate>${
    opts.description ? `<description>${opts.description}</description>` : ""
  }<source url="https://example.com">${opts.source}</source></item>`;
}

function rssFeedWith(...items: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${items.join("")}</channel></rss>`;
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (url.includes("generativelanguage.googleapis.com")) {
    const body = JSON.parse(init?.body ?? "{}");
    const systemText = body?.systemInstruction?.parts?.[0]?.text ?? "";
    if (systemText.includes("Google News search queries")) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ queries: geminiQueriesReply }) }] } }] }),
        { status: 200 }
      );
    }
    const withDefaults = { news_used_indices: [], ...geminiReply };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(withDefaults) }] } }] }), {
      status: 200,
    });
  }
  if (url.includes("news.google.com")) {
    newsFetchCount++;
    return new Response(newsRssXml, { status: 200 });
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

// 12. Relevant news: queries generated, RSS returns a real item, Gemini
// cites it by index -> NEWS ANGLE and SOURCES populated from real RSS data.
let readyWithNewsCardText = "";
{
  sentMessages.length = 0;
  newsFetchCount = 0;
  geminiQueriesReply = ["skincare formulation India"];
  newsRssXml = rssFeedWith(
    newsItemXml({
      title: "Skincare brands rethink formulas for humidity",
      source: "Economic Times",
      pubDate: "Wed, 24 Sep 2026 10:00:00 GMT",
      link: "https://example.com/humidity-story",
      description: "Indian skincare brands report a 23% rise in humidity-related complaints.",
    })
  );
  geminiReply = {
    status: "READY",
    score: 4,
    angle: "Climate-driven formulation",
    hook: "A hook informed by real news.",
    news_angle: "A recent Economic Times piece confirms this is an industry-wide pattern, not a one-off.",
    news_used_indices: [1],
    evidence_used: ["Customer complaint pattern from the note"],
    why_it_works: "Ties a founder observation to an external, verifiable trend.",
    warnings: [],
    draft: "Draft body citing the humidity trend.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 11, message: msg(11, "Customers in humid cities dislike our heavier serum texture.") } });
  const res = makeRes();
  await handler(req, res);
  readyWithNewsCardText = sentMessages[0]?.text ?? "";
  assert(newsFetchCount === 1, "relevant news -> RSS was actually fetched");
  assert(readyWithNewsCardText.includes("A recent Economic Times piece"), "relevant news -> NEWS ANGLE populated");
  assert(
    readyWithNewsCardText.includes(
      '[SOURCES: "Skincare brands rethink formulas for humidity - Economic Times" - Economic Times, 24 Sep 2026 - https://example.com/humidity-story]'
    ),
    "relevant news -> SOURCES built from real RSS data (title/source/date/url)"
  );
}

// 13. Irrelevant news: RSS returns items, but Gemini doesn't cite any of
// them -> None available, no fabricated news angle.
{
  sentMessages.length = 0;
  newsFetchCount = 0;
  geminiQueriesReply = ["skincare formulation India"];
  newsRssXml = rssFeedWith(
    newsItemXml({
      title: "Unrelated cricket match report",
      source: "Some Sports Site",
      pubDate: "Wed, 24 Sep 2026 10:00:00 GMT",
      link: "https://example.com/cricket",
    })
  );
  geminiReply = {
    status: "READY",
    score: 3,
    angle: "a",
    hook: "h",
    news_angle: null,
    news_used_indices: [],
    evidence_used: [],
    why_it_works: "w",
    warnings: [],
    draft: "Evergreen draft, no news tie-in.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 12, message: msg(12, "Another substantial founder note.") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(text.includes("[NEWS ANGLE: None available]"), "irrelevant news -> None available");
  assert(text.includes("[SOURCES: None]"), "irrelevant news -> no sources cited");
}

// 14. No news available: query generation itself returns no queries, so
// the RSS endpoint is never even called.
{
  sentMessages.length = 0;
  newsFetchCount = 0;
  geminiQueriesReply = [];
  geminiReply = {
    status: "READY",
    score: 3,
    angle: "a",
    hook: "h",
    news_angle: null,
    news_used_indices: [],
    evidence_used: [],
    why_it_works: "w",
    warnings: [],
    draft: "Evergreen draft.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 13, message: msg(13, "A note with no clear news-worthy topic.") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(newsFetchCount === 0, "no news queries generated -> RSS endpoint never called");
  assert(text.includes("[NEWS ANGLE: None available]"), "no news available -> None available");
}

// 15. Malformed RSS degrades gracefully: the webhook still completes
// normally instead of erroring out.
{
  sentMessages.length = 0;
  geminiQueriesReply = ["some query"];
  newsRssXml = "this is not valid xml at all {{{";
  geminiReply = {
    status: "READY",
    score: 3,
    angle: "a",
    hook: "h",
    news_angle: null,
    news_used_indices: [],
    evidence_used: [],
    why_it_works: "w",
    warnings: [],
    draft: "Draft body, unaffected by the broken feed.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 14, message: msg(14, "Another note entirely.") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(res.statusCode === 200, "malformed RSS -> webhook still returns 200");
  assert(text.includes("Draft body, unaffected by the broken feed."), "malformed RSS -> core flow completes normally");
  assert(text.includes("[NEWS ANGLE: None available]"), "malformed RSS -> treated as no news found");
}

// 16. A news-derived factual claim (a number that appears in the cited
// news item's description, not in the note) is NOT flagged by the
// numeric-claim backstop.
{
  sentMessages.length = 0;
  geminiQueriesReply = ["skincare formulation India"];
  newsRssXml = rssFeedWith(
    newsItemXml({
      title: "Industry report on humidity complaints",
      source: "Trade Press",
      pubDate: "Wed, 24 Sep 2026 10:00:00 GMT",
      link: "https://example.com/report",
      description: "The report cites a 23% increase in complaints.",
    })
  );
  geminiReply = {
    status: "READY",
    score: 4,
    angle: "a",
    hook: "h",
    news_angle: "An industry report confirms the same pattern.",
    news_used_indices: [1],
    evidence_used: [],
    why_it_works: "w",
    warnings: [],
    draft: "As a trade report notes, complaints of this kind rose 23% this year.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 15, message: msg(15, "A note about texture complaints, no numbers of its own.") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(!/23%.*doesn't appear/.test(text), "number sourced from cited news item -> not flagged as unsupported");
}

// 17. A number that appears in NEITHER the note NOR any cited news item is
// still flagged, even with news present in the request.
{
  sentMessages.length = 0;
  geminiQueriesReply = ["skincare formulation India"];
  newsRssXml = rssFeedWith(
    newsItemXml({
      title: "Industry report on humidity complaints",
      source: "Trade Press",
      pubDate: "Wed, 24 Sep 2026 10:00:00 GMT",
      link: "https://example.com/report",
      description: "General commentary, no figures given.",
    })
  );
  geminiReply = {
    status: "READY",
    score: 4,
    angle: "a",
    hook: "h",
    news_angle: "An industry report confirms the same pattern.",
    news_used_indices: [1],
    evidence_used: [],
    why_it_works: "w",
    warnings: [],
    draft: "Complaints of this kind rose 99% this year, an invented figure.",
    reason: null,
    missing: null,
    stronger_hint: null,
  };
  const req = makeReq({ body: { update_id: 16, message: msg(16, "A note about texture complaints, no numbers of its own.") } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(/99%.*doesn't appear in your original note/.test(text), "number in neither note nor cited news -> still flagged");
}

// 18. Follow-ups carry sources forward correctly: replying to a card that
// already has a SOURCES bracket, the follow-up's news_used_indices are
// resolved against THOSE prior sources (not a fresh RSS fetch).
{
  sentMessages.length = 0;
  newsFetchCount = 0;
  geminiReply = {
    status: "READY",
    score: 5,
    angle: "Climate-driven formulation",
    hook: "An even sharper hook, still citing the same news.",
    news_angle: "Still tied to the same Economic Times piece.",
    news_used_indices: [1],
    evidence_used: ["Customer complaint pattern from the note"],
    why_it_works: "Now sharper.",
    warnings: [],
    draft: "A rewritten draft that still cites the humidity trend.",
    reason: null,
    missing: null,
    stronger_hint: null,
    answer: null,
  };
  const req = makeReq({ body: { update_id: 17, message: msg(17, "/stronger", { text: readyWithNewsCardText }) } });
  const res = makeRes();
  await handler(req, res);
  const text = sentMessages[0]?.text ?? "";
  assert(newsFetchCount === 0, "follow-up news citation -> no fresh RSS fetch, reuses the prior card's sources");
  assert(
    text.includes(
      '[SOURCES: "Skincare brands rethink formulas for humidity - Economic Times" - Economic Times, 24 Sep 2026 - https://example.com/humidity-story]'
    ),
    "follow-up -> prior source carried forward exactly, resolved by index against the prior list"
  );
}

globalThis.fetch = realFetch;

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
