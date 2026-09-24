// Registers (or re-registers) the Telegram webhook against a deployed URL.
// Usage: npm run telegram:set-webhook -- https://your-app.vercel.app/api/telegram-webhook

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run telegram:set-webhook -- <https://your-app.vercel.app/api/telegram-webhook>");
  process.exit(1);
}

const token = requireEnv("TELEGRAM_BOT_TOKEN");
const secret = requireEnv("TELEGRAM_WEBHOOK_SECRET");

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message", "channel_post"],
    drop_pending_updates: true,
  }),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
if (!res.ok || json.ok === false) process.exit(1);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run this via: npm run telegram:set-webhook -- <url> (reads .env)`);
    process.exit(1);
  }
  return value;
}
