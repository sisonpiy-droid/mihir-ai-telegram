// Ad-hoc real Gemini check for one note, and optionally one follow-up on
// top of it. Costs a little, sends nothing to Telegram. Usage:
//   npm run check-note -- "<note text>"
//   npm run check-note -- "<note text>" -- "<follow-up text>"

import { getVoiceSkill } from "../lib/voice-skill.js";
import { decideAndDraft, generateFollowUp } from "../lib/gemini.js";
import { renderCard } from "../lib/card.js";

const args = process.argv.slice(2);
const sepIndex = args.indexOf("--");
const note = (sepIndex === -1 ? args : args.slice(0, sepIndex)).join(" ");
const followUp = sepIndex === -1 ? undefined : args.slice(sepIndex + 1).join(" ");

if (!note) {
  console.error('Usage: npm run check-note -- "<note text>" [-- "<follow-up text>"]');
  process.exit(1);
}

const geminiApiKey = process.env.GEMINI_API_KEY!;
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const voiceSkill = getVoiceSkill();

const card = await decideAndDraft(geminiApiKey, geminiModel, voiceSkill, note);
console.log(renderCard({ ...card, sourceNote: note }));

if (followUp) {
  console.log(`\n\n>>> follow-up: ${followUp}\n`);
  const updated = await generateFollowUp(geminiApiKey, geminiModel, voiceSkill, card, note, followUp);
  console.log(renderCard({ ...updated, sourceNote: note }));
}
