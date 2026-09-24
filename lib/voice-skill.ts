import { readFileSync } from "node:fs";
import { join } from "node:path";

// voice-skill.txt lives at the project root and is Meera's writing-voice
// instructions. It's declared in vercel.json's `includeFiles` so it ships
// inside the deployed function bundle, where process.cwd() is the project
// root.
let cached: string | undefined;

export function getVoiceSkill(): string {
  if (cached !== undefined) return cached;
  const path = join(process.cwd(), "voice-skill.txt");
  try {
    cached = readFileSync(path, "utf-8").trim();
  } catch (err) {
    throw new Error(
      `Could not read voice-skill.txt at ${path}. Make sure it exists at the project root. (${(err as Error).message})`
    );
  }
  if (!cached) {
    throw new Error("voice-skill.txt is empty. Fill it in with Meera's voice/style instructions.");
  }
  return cached;
}
