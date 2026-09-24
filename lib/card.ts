// The bracket-metadata "card" format sent to Telegram, and the parser that
// recovers it from a replied-to message. There is no database here: the
// card embeds the original note text, so replying to a card round-trips
// everything the bot needs to answer a follow-up (see api/telegram-webhook.ts).

export interface ReadyCardBase {
  status: "READY";
  score: number;
  angle: string;
  hook: string;
  newsAngle?: string;
  evidenceUsed: string[];
  whyItWorks: string;
  warnings: string[];
  draft: string;
  answer?: string;
}

export interface NotReadyCardBase {
  status: "NOT_READY";
  score: number;
  reason: string;
  missing: string;
  strongerHint: string;
  answer?: string;
}

export type CardBase = ReadyCardBase | NotReadyCardBase;

export type Card = (ReadyCardBase & { sourceNote: string }) | (NotReadyCardBase & { sourceNote: string });

const DRAFT_MARKER = "DRAFT LINKEDIN POST";

function bracket(key: string, value: string): string {
  return `[${key}: ${value.replace(/\s+/g, " ").trim()}]`;
}

export function renderCard(card: Card): string {
  const parts: string[] = [];

  if (card.answer) {
    parts.push(bracket("ANSWER", card.answer));
    parts.push("");
  }

  if (card.status === "READY") {
    parts.push(bracket("STATUS", "READY"));
    parts.push(bracket("SCORE", `${card.score}/5`));
    parts.push(bracket("ANGLE", card.angle));
    parts.push(bracket("HOOK", card.hook));
    parts.push(bracket("NEWS ANGLE", card.newsAngle || "None available"));
    parts.push(bracket("EVIDENCE", card.evidenceUsed.length ? card.evidenceUsed.join("; ") : "None"));
    parts.push(bracket("WHY IT WORKS", card.whyItWorks));
    parts.push(bracket("WARNINGS", card.warnings.length ? card.warnings.join("; ") : "None"));
    parts.push("");
    parts.push("Review before posting -- nothing is published automatically.");
    parts.push("");
    parts.push(DRAFT_MARKER);
    parts.push("");
    parts.push(card.draft.trim());
  } else {
    parts.push(bracket("STATUS", "NOT READY"));
    parts.push(bracket("SCORE", `${card.score}/5`));
    parts.push(bracket("REASON", card.reason));
    parts.push(bracket("MISSING", card.missing));
    parts.push(bracket("WHAT WOULD MAKE IT STRONGER", card.strongerHint));
  }

  parts.push("");
  parts.push(`[SOURCE NOTE: ${card.sourceNote.trim()}]`);

  return parts.join("\n");
}

const FIELD_RE =
  /^\[(STATUS|SCORE|ANGLE|HOOK|NEWS ANGLE|EVIDENCE|WHY IT WORKS|WARNINGS|REASON|MISSING|WHAT WOULD MAKE IT STRONGER):\s*(.*)\]$/gm;

/**
 * Recovers a Card from a previously-rendered message (e.g. the text of a
 * Telegram reply_to_message). Returns null if the text isn't one of our
 * cards -- e.g. Meera replied to her own plain note instead of a bot reply.
 */
export function parseCard(text: string): Card | null {
  const statusIdx = text.indexOf("[STATUS:");
  if (statusIdx === -1) return null;
  const body = text.slice(statusIdx);

  const fields: Record<string, string> = {};
  for (const m of body.matchAll(FIELD_RE)) {
    fields[m[1]] = m[2].trim();
  }
  if (!fields.STATUS) return null;

  const scoreNum = parseInt(fields.SCORE ?? "", 10);
  const score = Number.isFinite(scoreNum) ? scoreNum : 0;

  const sourceNoteMatch = /\[SOURCE NOTE:\s*([\s\S]*)\]\s*$/.exec(text);
  const sourceNote = sourceNoteMatch ? sourceNoteMatch[1].trim() : "";
  if (!sourceNote) return null; // no recoverable note -> can't support a follow-up

  if (fields.STATUS.toUpperCase() === "READY") {
    const draftStart = body.indexOf(DRAFT_MARKER);
    let draft = "";
    if (draftStart !== -1) {
      const afterMarker = body.slice(draftStart + DRAFT_MARKER.length);
      const sourceNoteStart = afterMarker.indexOf("[SOURCE NOTE:");
      draft = (sourceNoteStart === -1 ? afterMarker : afterMarker.slice(0, sourceNoteStart)).trim();
    }
    if (!draft) return null;
    return {
      status: "READY",
      score,
      angle: fields.ANGLE ?? "",
      hook: fields.HOOK ?? "",
      newsAngle: fields["NEWS ANGLE"] && fields["NEWS ANGLE"] !== "None available" ? fields["NEWS ANGLE"] : undefined,
      evidenceUsed: splitList(fields.EVIDENCE),
      whyItWorks: fields["WHY IT WORKS"] ?? "",
      warnings: splitList(fields.WARNINGS),
      draft,
      sourceNote,
    };
  }

  return {
    status: "NOT_READY",
    score,
    reason: fields.REASON ?? "",
    missing: fields.MISSING ?? "",
    strongerHint: fields["WHAT WOULD MAKE IT STRONGER"] ?? "",
    sourceNote,
  };
}

function splitList(value: string | undefined): string[] {
  if (!value || value === "None") return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
