// Central place to read and validate environment variables.

export interface Config {
  telegramBotToken: string;
  telegramWebhookSecret: string;
  telegramAllowedChatId: string;
  geminiApiKey: string;
  geminiModel: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached) return cached;
  cached = {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
    telegramAllowedChatId: required("TELEGRAM_ALLOWED_CHAT_ID"),
    geminiApiKey: required("GEMINI_API_KEY"),
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  };
  return cached;
}
