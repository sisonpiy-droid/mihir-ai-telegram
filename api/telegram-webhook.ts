import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getConfig } from "../lib/config.js";
import { getVoiceSkill } from "../lib/voice-skill.js";
import { decideAndDraft, generateFollowUp, generateNewsQueries } from "../lib/gemini.js";
import { TelegramClient, type TelegramUpdate } from "../lib/telegram.js";
import { renderCard, parseCard } from "../lib/card.js";
import { searchGoogleNews, mergeAndRankNews, type NewsItem } from "../lib/news.js";

const KNOWN_COMMANDS = [
  "/score",
  "/hooks",
  "/angle",
  "/stronger",
  "/shorter",
  "/expand",
  "/objections",
  "/takeaway",
  "/ending",
  "/personal",
  "/contrarian",
  "/check",
];

// Telegram retries a webhook if it doesn't get a 2xx quickly, and retries
// can pile up into duplicate work. We always return 200 once the update has
// been read, and do the real work (which can fail) inside a try/catch that
// reports the error back into the same chat instead of throwing.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  let config;
  try {
    config = getConfig();
  } catch (err) {
    console.error("Config error:", err);
    res.status(500).send("Server misconfigured");
    return;
  }

  const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (secretHeader !== config.telegramWebhookSecret) {
    console.warn("Rejected webhook call with bad/missing secret token");
    res.status(401).send("Unauthorized");
    return;
  }

  const update = req.body as TelegramUpdate;
  const message = update.message ?? update.channel_post;

  if (!message || typeof message.text !== "string" || !message.text.trim()) {
    // Nothing we can act on (photo, sticker, edited message, etc.) - ignore.
    res.status(200).send("ok");
    return;
  }

  const chatId = message.chat.id;
  if (String(chatId) !== config.telegramAllowedChatId) {
    console.warn(`Rejected message from unauthorized chat ${chatId}`);
    res.status(200).send("ok"); // don't leak info to strangers messaging the bot
    return;
  }

  const text = message.text.trim();
  const telegram = new TelegramClient(config.telegramBotToken);

  if (text.startsWith("/start")) {
    await safeSend(
      telegram,
      chatId,
      "Hi Meera! Send me any note or idea and I'll score it and draft it in your voice if it's ready. Reply to a draft (or a \"not ready\" card) with a follow-up -- /score, /hooks, /angle, /stronger, /shorter, /expand, /objections, /takeaway, /ending, /personal, /contrarian, /check, or just plain language like \"make this more shareable\" -- to keep working on it. You always review and post it yourself; I never publish anything."
    );
    res.status(200).send("ok");
    return;
  }

  // A follow-up is identified purely by replying to one of our own cards
  // (channels don't expose per-message authorship, so content is the only
  // reliable signal). No reply, or a reply to something else -> new note.
  const priorCard = message.reply_to_message?.text ? parseCard(message.reply_to_message.text) : null;

  if (!priorCard && KNOWN_COMMANDS.includes(text.toLowerCase())) {
    await safeSend(
      telegram,
      chatId,
      `Reply to the draft or "not ready" card you want to follow up on, then send ${text} again.`
    );
    res.status(200).send("ok");
    return;
  }

  try {
    const voiceSkill = getVoiceSkill();

    if (priorCard) {
      const updated = await generateFollowUp(config.geminiApiKey, config.geminiModel, voiceSkill, priorCard, priorCard.sourceNote, text);
      await telegram.sendMessage(chatId, renderCard({ ...updated, sourceNote: priorCard.sourceNote }));
    } else {
      const newsItems = await findRelevantNews(config.geminiApiKey, config.geminiModel, text);
      const card = await decideAndDraft(config.geminiApiKey, config.geminiModel, voiceSkill, text, newsItems);
      await telegram.sendMessage(chatId, renderCard({ ...card, sourceNote: text }));
    }
  } catch (err) {
    console.error("Error handling message:", err);
    await safeSend(telegram, chatId, "Something went wrong while working on that. Please try again in a bit.");
  }

  res.status(200).send("ok");
}

async function safeSend(telegram: TelegramClient, chatId: number, text: string): Promise<void> {
  try {
    await telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error("Failed to notify chat about an earlier error:", err);
  }
}

/**
 * News is optional context, not a required step -- any failure here (a
 * Gemini hiccup, Google News being unreachable, malformed RSS) degrades to
 * "no news found" rather than failing the whole request. The core
 * screening/scoring/drafting flow must keep working with or without it.
 */
async function findRelevantNews(apiKey: string, model: string, note: string): Promise<NewsItem[]> {
  try {
    const queries = await generateNewsQueries(apiKey, model, note);
    if (!queries.length) return [];
    const resultsByQuery = await Promise.all(queries.map((q) => searchGoogleNews(q)));
    return mergeAndRankNews(resultsByQuery);
  } catch (err) {
    console.error("News search failed, continuing without it:", err);
    return [];
  }
}
