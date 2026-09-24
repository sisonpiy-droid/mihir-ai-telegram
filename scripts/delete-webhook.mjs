// Removes the webhook -- handy before switching to a new deployment URL,
// or before using getUpdates to find a chat ID (Telegram forbids polling
// with getUpdates while a webhook is active).

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN (reads .env)");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: "POST" });
console.log(JSON.stringify(await res.json(), null, 2));
