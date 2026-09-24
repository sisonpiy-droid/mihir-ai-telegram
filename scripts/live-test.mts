// Real call to the real Gemini API (reads .env, costs a little). No
// Telegram messages are sent -- this only prints the rendered card.
// Run with: npm run test:live

import { getVoiceSkill } from "../lib/voice-skill.js";
import { decideAndDraft } from "../lib/gemini.js";
import { renderCard } from "../lib/card.js";

const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";
if (!geminiApiKey) {
  console.error("Missing GEMINI_API_KEY in .env");
  process.exit(1);
}

const voiceSkill = getVoiceSkill();

const samples = [
  {
    label: "thin note (expect: NOT_READY)",
    note: "feeling tired today, not much going on",
  },
  {
    label: "substantial note with real evidence (expect: READY)",
    note:
      "In the 12 months to June 2025, 23% of our product returns came from customers who mentioned texture or feel. 71% of those returns came from cities with average annual humidity above 70%. After we reformulated the base, returns from humid cities dropped to 8% in the following quarter.",
  },
];

for (const sample of samples) {
  console.log(`\n=== ${sample.label} ===`);
  console.log(`note: ${sample.note}\n`);
  const card = await decideAndDraft(geminiApiKey, geminiModel, voiceSkill, sample.note);
  console.log(renderCard({ ...card, sourceNote: sample.note }));
}
