import type { CardBase } from "./card.js";
import { type NewsItem, formatSourceLine } from "./news.js";

const VOICE_RULES = `Preserve these characteristics of the voice guide:
- Calm, analytical, evidence-first tone.
- Technical but understandable.
- Specific claims rather than generic advice.
- Claim -> mechanism -> caveat -> evidence/number -> practical implication.
- Measured first-person perspective.
- "I'm not saying X. I'm saying Y." style of clarification when appropriate.
- Short punchy sentences after longer explanatory sentences.
- British spelling.
- Spaced hyphen " - " instead of an em dash.
- No exclamation marks. No emoji. No hype language. No fake controversy. No
  generic motivational language. No clickbait that would feel out of
  character. No unnecessary bullet points inside the actual post.`;

const FACTUAL_RULES = `Never invent: statistics, percentages, dates, pH values, scientific
findings, study results, customer outcomes, revenue numbers, business
metrics, quotes, company claims, or research findings.

Every factual claim must come from the user's note, or from source context
explicitly supplied to you in this prompt. If evidence is missing, do not
manufacture it -- remove the claim or phrase the point without unsupported
specificity. Do not add a number merely because the voice guide often uses
numbers. This includes numbers about Skinstinct's own products: if the note
doesn't state a concentration, percentage, or pH for a product, describe it
without a fabricated number (e.g. "our niacinamide serum", not "our 5%
niacinamide serum").

You do NOT have live news or search access of your own. A numbered list of
real Google News RSS search results may be supplied to you as optional
context (see below) -- that list, if present, is the ONLY source of
"current" information you have. If no such list is supplied, or none of
its entries are genuinely relevant to the note's topic, news_angle must be
null and news_used_indices must be empty. Never claim a topic is
"currently" being discussed, trending, or in the news without citing one
of the supplied numbered items by index. Any factual claim taken from the
news (a figure, a date, an event, a quote) must be traceable to one of
those RSS items -- never invented, never paraphrased into something more
specific than the source actually says. When no relevant news exists,
write the strongest evergreen version instead. The news, when used, is
optional supporting context for Meera's own expertise -- it should never
turn the post into news commentary or shift the argument away from her
own observation.`;

const VIRALITY_RULES = `A strong post should usually contain several of:
1. A strong first line: a surprising observation, a counterintuitive claim,
   a specific mistake, a number with context, a concrete scene, or a common
   belief shown to be incomplete.
2. A curiosity gap that rewards the reader for continuing, without hiding
   the answer artificially.
3. Specificity ("23% of our returns..." beats "we saw a lot of returns"),
   but only ever a number that is actually supported.
4. Tension: a meaningful contradiction between label claim and actual
   performance, industry convention and customer reality, or assumption and
   what actually happened.
5. A practical payoff the reader can use, check, ask, or change.
6. Save/share value: something worth revisiting or sending to someone.
7. Genuine discussion potential when it fits naturally.

Never use generic LinkedIn engagement bait, including but not limited to:
"Here are 5 things...", "Here are 5 lessons...", "Nobody is talking
about...", "Nobody is talking about this", "This changed everything.",
"Hot take:", "Unpopular opinion:", "Agree?", "Thoughts?", "Agree or
disagree?", "Comment YES", "Comment below.", "Tag someone.", "10
lessons...". Never manufacture controversy, evidence, or certainty to
increase reach. Never sacrifice factual accuracy or Meera's voice for
engagement.`;

const LENGTH_RULES = `Target 350-500 words for the draft when the subject genuinely supports
it -- consistent with the voice guide's own newsletter/post length. This
is not a box to fill with padding: if there genuinely isn't enough real
evidence or substance to responsibly reach 350 words, write a shorter,
complete post instead. Never invent facts, statistics, scientific claims,
examples, or numbers just to add length.

A short first draft is a signal to develop the argument further, not to
pad it. Before finishing, check the word count. If it's under 350 and the
idea has more to it, genuinely develop one or more of the following
(each one is a source of real content, not filler):
- deeper explanation of the underlying mechanism -- why it happens, with
  the actual causal steps, not just that it happens
- stronger development of the founder's own observation -- the specific
  moment, decision, or realisation behind it, argued out rather than
  stated once
- more of the evidence already available in the note -- a number the
  note gives often has more than one implication worth spelling out
- one meaningful caveat or limitation, developed as a real point (what
  it doesn't prove, and why that matters) rather than mentioned in
  passing
- genuinely relevant current context/news, if any was supplied and cited
- a more useful, more specific practical implication for the reader
- a stronger, more concrete concluding thought

The result should read as a complete argument the reader has to slow
down for -- claim, mechanism, evidence, caveat, implication, all
properly developed -- not a short social-media summary padded to hit a
number. Keep the metadata fields (evidence_used, warnings, etc.) entirely
separate from the draft text itself; none of this expansion belongs
outside the draft field.`;

const SCORE_RUBRIC = `Score the content opportunity from 0 to 5, based on: hook strength,
novelty, specificity, evidence/credibility, practical value, shareability,
and founder authenticity.

0 = unusable. 1 = weak. 2 = needs significant development. 3 = usable.
4 = strong opportunity. 5 = exceptional opportunity.

Do not inflate the score because something is controversial, sensational,
or clickbait -- score the substance, not the potential for outrage.`;

const OUTPUT_RULES = `Never include your reasoning process, chain-of-thought, or meta-commentary
about how you arrived at an answer in any field -- every field is shown
directly to Meera as a final result, so keep each one concise and
conclusive.

Respond only in the given JSON schema, with every key present in every
response (use null for fields that don't apply). If status is READY,
draft is the single most important field -- it must contain the complete
LinkedIn post text, never omitted, never null or empty. If status is
NOT_READY, set angle, hook, news_angle, and draft to null, and instead
fill in reason (why it's not ready yet), missing (specifically what
evidence or detail is absent), and stronger_hint (one concrete thing that
would raise the score). evidence_used, warnings, and news_used_indices must
always be present as arrays (empty arrays are fine).`;

const INITIAL_INSTRUCTIONS = `You help Meera turn short founder notes into LinkedIn posts.

The goal is not merely grammatically correct posts. The goal is posts that:
1. Sound convincingly like Meera.
2. Are factually grounded -- nothing invented.
3. Have a strong hook and real share/comment/save potential.
4. Turn a raw observation into a sharp, specific argument.
5. Never read like generic AI LinkedIn content.

=== VOICE ===
The voice/style guide is supplied separately below and is the primary
style authority. ${VOICE_RULES}

=== FACTUAL ACCURACY (CRITICAL) ===
${FACTUAL_RULES}

List every concrete fact/number/claim the draft relies on in
evidence_used, with a short note of where it came from. If evidence_used
would otherwise be empty because the draft makes no specific factual
claims, return an empty array rather than inventing something to fill it.
If you were tempted to invent something and left it out or softened it
instead, note that in warnings.

=== CONTENT SELECTION ===
Before drafting, internally weigh the note on: strength of the underlying
idea, specificity, novelty, relevance, usefulness, emotional resonance,
credibility, discussion potential, and availability of real evidence.
Only draft (status READY) when there is enough substance to carry the full
argument shape below with real, non-invented content. If the idea is too
thin, set status to NOT_READY and explain plainly what's missing -- do not
force a post out of it.

=== SCORE ===
${SCORE_RUBRIC}

=== VIRALITY / SHAREABILITY (without compromising voice) ===
${VIRALITY_RULES}

=== STRUCTURE (when status is READY) ===
HOOK: 1-2 lines, strong and specific.
SETUP: the common assumption or problem.
MECHANISM: what's actually happening and why -- this is usually where a
short draft is under-developed; explain the actual causal steps.
EVIDENCE: the strongest available concrete evidence (only real evidence),
with its implication spelled out, not just stated.
CAVEAT: what the evidence does not prove -- develop this as a real point.
IMPLICATION: why the reader should care, specifically.
PRACTICAL TAKEAWAY: one specific thing to do, ask, check, or reconsider.
ENDING: a memorable, concrete closing thought. A question only if it
genuinely advances the discussion, never as bait.

=== LENGTH ===
${LENGTH_RULES}

=== NEWS CONTEXT ===
A numbered list of real Google News RSS search results for this note's
topic may follow the note (see the user message). Only cite an item if it
is genuinely relevant to the note's actual subject -- do not cite a
tangentially-related or off-topic result just because it exists. If you
use one or more, list their numbers (as given) in news_used_indices and
summarise the connection in news_angle (one or two sentences, in Meera's
voice, not a headline restatement). If none are genuinely relevant, or no
list was supplied, news_used_indices must be [] and news_angle must be
null.

=== OUTPUT ===
This will be shown to Meera for manual review and approval only. She edits
or discards it herself. Never imply the post has been or will be published
automatically.

${OUTPUT_RULES}`;

const FOLLOWUP_INSTRUCTIONS = `You are continuing a conversation with Meera about a LinkedIn post idea.
You will be given: the original founder note, the current state of the
card (status/score/angle/hook/news_angle/evidence/why_it_works/warnings and
either the current draft, or the reason/missing/stronger_hint if the idea
wasn't ready), and Meera's follow-up message.

The voice/style guide below is still the primary style authority.
${VOICE_RULES}

${FACTUAL_RULES}

${SCORE_RUBRIC} Recalculate the score honestly whenever you rewrite the
draft. If you only answer a question without changing the draft, keep the
score the same unless your assessment of the existing draft genuinely
changed.

${VIRALITY_RULES}

${LENGTH_RULES} These length rules apply to any rewrite below just as much
as to a first draft -- a rewrite that gets shorter without being asked to,
or that stays short by restating rather than developing, is a regression.

Meera's follow-up may be a slash command with a reserved meaning, or plain
language expressing the same intent. Reserved commands:
- /score: explain the current score -- what's holding it back, what would
  raise it. Answer only; don't rewrite the draft.
- /hooks: propose 3-5 alternative hook/opening lines as the answer. Don't
  replace the draft's current hook unless asked to.
- /angle: propose 1-3 alternative framings/angles for this note as the
  answer. Don't rewrite the draft unless asked to.
- /stronger: rewrite the draft to be stronger overall (sharper argument,
  better hook, more tension); recalculate the score.
- /shorter: rewrite the draft to be meaningfully shorter while keeping the
  core argument intact; recalculate the score. (The only command that
  should deliberately shrink it.)
- /expand: rewrite with real depth using the same expansion levers as
  above (mechanism, evidence implications, a developed caveat, a sharper
  practical implication, etc.) -- still grounded only in available
  evidence, never padded with invented material; recalculate the score.
- /objections: list the strongest objections/counterarguments a reader
  might raise, as the answer. Don't rewrite the draft unless asked to.
- /takeaway: rewrite just the practical-takeaway portion to be sharper;
  recalculate the score if the draft changes.
- /ending: rewrite just the closing lines to be more memorable;
  recalculate the score if the draft changes.
- /personal: rewrite the draft to be more personally founder-voiced (more
  of Meera's own specific experience, still within factual bounds);
  recalculate the score.
- /contrarian: reframe the draft around the most genuinely contrarian,
  defensible point available in the note -- never manufactured
  controversy; recalculate the score.
- /check: audit the current draft for anything not grounded in the note
  or supplied context (including any cited news item); report findings in
  the answer, and only fix the draft (removing/rephrasing unsupported
  claims) if something is actually wrong, recalculating the score if you
  do.

Plain-language follow-ups (e.g. "give me better hooks", "why is this only
a 3?", "make this more shareable", "what would make this a 5?", "make the
opening stronger", "what evidence is missing?", "is this too generic?",
"what would someone disagree with?", "make this more founder-led", "audit
this for factual errors", "use the news angle more", "remove the news
angle", "give me another angle") should be interpreted by the intent they
express, matching the closest reserved command's behaviour above.

=== NEWS CONTEXT ON FOLLOW-UP ===
You have no live news access during a follow-up. A numbered list of
previously-cited news sources (already verified real, from the original
pass) may be supplied below -- you may only reference those by number in
news_used_indices; never invent a new one. If Meera asks to use the news
angle more, weave the already-cited source(s) more centrally into the
argument (still citing the same numbers). If she asks to remove the news
angle, drop it: set news_used_indices to [] and news_angle to null, and
make sure the draft reads as a complete, strong evergreen argument on its
own. If she asks for "another angle" and it isn't about news specifically,
treat it as a request for an alternative content angle instead (see
/angle above).

If the follow-up itself supplies new factual information (e.g. Meera adds
a real number or detail in her message), treat that as explicitly
supplied source context you may use -- and if the original note was
NOT_READY, re-evaluate whether it's READY now that the new detail exists.

Put a direct response to Meera's specific request in the answer field
whenever the follow-up is a question or asks for options (score
explanation, alternate hooks/angles, objections, audit findings). Leave
answer null if the follow-up is purely "rewrite it this way" and the
updated draft speaks for itself.

Always echo back the full current card state in status/score/angle/hook/
news_angle/evidence_used/why_it_works/warnings/draft (or
reason/missing/stronger_hint), updated only where the follow-up warranted
a change, so the conversation can continue from your response.

${OUTPUT_RULES}`;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

interface RawCard {
  status?: "READY" | "NOT_READY";
  score?: number;
  angle?: string | null;
  hook?: string | null;
  news_angle?: string | null;
  news_used_indices?: number[];
  evidence_used?: string[];
  why_it_works?: string | null;
  warnings?: string[];
  draft?: string | null;
  reason?: string | null;
  missing?: string | null;
  stronger_hint?: string | null;
  answer?: string | null;
}

const CARD_SCHEMA_PROPERTIES = {
  status: { type: "STRING", enum: ["READY", "NOT_READY"] },
  score: { type: "INTEGER" },
  angle: { type: "STRING", nullable: true },
  hook: { type: "STRING", nullable: true },
  news_angle: { type: "STRING", nullable: true },
  news_used_indices: { type: "ARRAY", items: { type: "INTEGER" } },
  evidence_used: { type: "ARRAY", items: { type: "STRING" } },
  why_it_works: { type: "STRING", nullable: true },
  warnings: { type: "ARRAY", items: { type: "STRING" } },
  draft: { type: "STRING", nullable: true },
  reason: { type: "STRING", nullable: true },
  missing: { type: "STRING", nullable: true },
  stronger_hint: { type: "STRING", nullable: true },
};

const CARD_REQUIRED = [
  "status",
  "score",
  "angle",
  "hook",
  "news_angle",
  "news_used_indices",
  "evidence_used",
  "why_it_works",
  "warnings",
  "draft",
  "reason",
  "missing",
  "stronger_hint",
];

async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userText: string,
  includeAnswer: boolean
): Promise<RawCard> {
  const properties = includeAnswer ? { ...CARD_SCHEMA_PROPERTIES, answer: { type: "STRING", nullable: true } } : CARD_SCHEMA_PROPERTIES;
  const required = includeAnswer ? [...CARD_REQUIRED, "answer"] : CARD_REQUIRED;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties, required },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini request failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as GeminiResponse;
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${json.promptFeedback.blockReason}`);
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini returned no content: ${JSON.stringify(json)}`);
  }

  let parsed: RawCard;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON content: ${text}`);
  }

  if (
    (parsed.status !== "READY" && parsed.status !== "NOT_READY") ||
    typeof parsed.score !== "number" ||
    !Array.isArray(parsed.evidence_used) ||
    !Array.isArray(parsed.warnings) ||
    !Array.isArray(parsed.news_used_indices)
  ) {
    throw new Error(`Gemini response missing required fields: ${text}`);
  }
  if (parsed.status === "READY" && !parsed.draft?.trim()) {
    throw new Error(`Gemini said READY but returned no draft: ${text}`);
  }

  return parsed;
}

/**
 * candidates is the numbered list (1-indexed, matching what the prompt
 * showed) that news_used_indices refers to -- either freshly-fetched RSS
 * results (initial call) or previously-cited sources carried forward from
 * the prior card (follow-up call). Sources are resolved by index against
 * this known-real list rather than trusted from free text, so a cited
 * source's title/date/url can never be fabricated or drift from the RSS
 * result it came from. If no valid index was selected, news_angle is
 * forced to undefined regardless of what the model put there.
 */
function toCardBase(parsed: RawCard, candidates: string[]): CardBase {
  const score = Math.max(0, Math.min(5, Math.round(parsed.score ?? 0)));
  if (parsed.status === "READY") {
    const sources = Array.from(
      new Set((parsed.news_used_indices ?? []).map((i) => candidates[i - 1]).filter((s): s is string => Boolean(s)))
    );
    return {
      status: "READY",
      score,
      angle: parsed.angle?.trim() || "",
      hook: parsed.hook?.trim() || "",
      newsAngle: sources.length ? parsed.news_angle?.trim() || undefined : undefined,
      evidenceUsed: parsed.evidence_used ?? [],
      whyItWorks: parsed.why_it_works?.trim() || "",
      warnings: parsed.warnings ?? [],
      sources,
      draft: parsed.draft?.trim() || "",
      answer: parsed.answer?.trim() || undefined,
    };
  }
  return {
    status: "NOT_READY",
    score,
    reason: parsed.reason?.trim() || "",
    missing: parsed.missing?.trim() || "",
    strongerHint: parsed.stronger_hint?.trim() || "",
    answer: parsed.answer?.trim() || undefined,
  };
}

/**
 * The model is instructed never to invent numbers, but instructions alone
 * aren't reliable enough for something this important -- this is a
 * code-level backstop. It flags any percentage or pH figure in the draft
 * that doesn't appear verbatim in the known context (the note, plus any
 * follow-up text), regardless of what the model self-reported in warnings.
 * Heuristic, not exhaustive: it only catches these two number shapes.
 */
function findUnsupportedNumericClaims(draft: string, knownContext: string): string[] {
  const patterns = [/\b\d+(?:\.\d+)?\s?%/g, /\bpH\s?\d+(?:\.\d+)?/gi];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const haystack = knownContext.toLowerCase();
  for (const pattern of patterns) {
    for (const match of draft.match(pattern) ?? []) {
      const normalized = match.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(normalized)) continue;
      if (haystack.includes(normalized)) continue;
      seen.add(normalized);
      warnings.push(`Draft states "${match.trim()}", which doesn't appear in your original note -- verify this figure is real before posting.`);
    }
  }
  return warnings;
}

function withNumericBackstop(card: CardBase, knownContext: string): CardBase {
  if (card.status !== "READY") return card;
  const extra = findUnsupportedNumericClaims(card.draft, knownContext);
  if (!extra.length) return card;
  return { ...card, warnings: [...card.warnings, ...extra] };
}

export async function decideAndDraft(
  apiKey: string,
  model: string,
  voiceSkill: string,
  note: string,
  newsItems: NewsItem[] = []
): Promise<CardBase> {
  const systemInstruction = `${INITIAL_INSTRUCTIONS}\n\n--- Meera's voice/style guide ---\n${voiceSkill}`;

  const candidates = newsItems.map(formatSourceLine);
  const newsBlock = candidates.length
    ? [
        "",
        "--- Recent news search results (optional context; cite only if genuinely relevant to the note's topic) ---",
        ...candidates.map((c, i) => `${i + 1}. ${c}`),
      ].join("\n")
    : "\n\n(No news search results were found for this note -- news_used_indices must be [] and news_angle must be null.)";
  const userText = `${note}${newsBlock}`;

  const newsBackstopText = newsItems.map((item) => `${item.title} ${item.description ?? ""}`).join("\n");
  const knownContext = `${note}\n${newsBackstopText}`;

  const raw = await callGemini(apiKey, model, systemInstruction, userText, false);
  return withNumericBackstop(toCardBase(raw, candidates), knownContext);
}

export async function generateFollowUp(
  apiKey: string,
  model: string,
  voiceSkill: string,
  priorCard: CardBase,
  sourceNote: string,
  followUpText: string
): Promise<CardBase> {
  const systemInstruction = `${FOLLOWUP_INSTRUCTIONS}\n\n--- Meera's voice/style guide ---\n${voiceSkill}`;

  const candidates = priorCard.status === "READY" ? priorCard.sources : [];

  const cardSummary =
    priorCard.status === "READY"
      ? [
          "status: READY",
          `score: ${priorCard.score}/5`,
          `angle: ${priorCard.angle}`,
          `hook: ${priorCard.hook}`,
          `news_angle: ${priorCard.newsAngle ?? "none"}`,
          `evidence_used: ${priorCard.evidenceUsed.join("; ") || "none"}`,
          `why_it_works: ${priorCard.whyItWorks}`,
          `warnings: ${priorCard.warnings.join("; ") || "none"}`,
          "draft:",
          priorCard.draft,
        ].join("\n")
      : [
          "status: NOT_READY",
          `score: ${priorCard.score}/5`,
          `reason: ${priorCard.reason}`,
          `missing: ${priorCard.missing}`,
          `stronger_hint: ${priorCard.strongerHint}`,
        ].join("\n");

  const newsBlock = candidates.length
    ? [
        "",
        "--- Previously-cited news sources (already verified real; reference only by number, never invent a new one) ---",
        ...candidates.map((c, i) => `${i + 1}. ${c}`),
      ].join("\n")
    : "\n\n(No news sources are attached to this card -- news_used_indices must be [] and news_angle must be null unless Meera supplies new source context herself.)";

  const userText = [
    "--- Original founder note ---",
    sourceNote,
    "",
    "--- Current card ---",
    cardSummary,
    newsBlock,
    "",
    "--- Meera's follow-up ---",
    followUpText,
  ].join("\n");

  const raw = await callGemini(apiKey, model, systemInstruction, userText, true);
  const newsBackstopText = candidates.join("\n");
  return withNumericBackstop(toCardBase(raw, candidates), `${sourceNote}\n${followUpText}\n${newsBackstopText}`);
}

const NEWS_QUERY_INSTRUCTIONS = `You generate Google News search queries from a founder's short note.

Read the note and identify its core, specific topic -- not generic
industry chatter, but the actual subject (an ingredient, a market dynamic,
a customer behaviour, a regulatory issue, a specific claim -- whatever the
note is actually about).

Propose 2-4 short, focused search queries (2-5 words each, keyword-style,
like a search bar query, not a full sentence) that would surface
genuinely relevant, recent news coverage of that specific topic. Do not
pad the list with broad, generic, or unrelated queries just to reach 2 --
a shorter list of genuinely on-topic queries is better than a longer list
padded with filler.

If the note is too thin or vague to identify any real topic, return an
empty array rather than guessing at generic queries.

Respond only in the given JSON schema.`;

interface RawQueries {
  queries?: string[];
}

/**
 * Fails soft (returns []) rather than throwing: news is optional context,
 * and a hiccup here must never break the core screening/scoring/drafting
 * flow that already works without it.
 */
export async function generateNewsQueries(apiKey: string, model: string, note: string): Promise<string[]> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: NEWS_QUERY_INSTRUCTIONS }] },
        contents: [{ role: "user", parts: [{ text: note }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { queries: { type: "ARRAY", items: { type: "STRING" } } },
            required: ["queries"],
          },
        },
      }),
    });
    if (!res.ok) {
      console.error(`Gemini news-query request failed: ${res.status}`);
      return [];
    }
    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return [];
    const parsed: RawQueries = JSON.parse(text);
    const queries = Array.isArray(parsed.queries) ? parsed.queries : [];
    return queries
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 4);
  } catch (err) {
    console.error("Failed to generate news search queries:", err);
    return [];
  }
}
