// Prints Telegram's current webhook status -- useful for confirming
// registration and for finding chat IDs via getUpdates when no webhook is set.

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN (reads .env)");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
console.log(JSON.stringify(await res.json(), null, 2));
