// Helps discover TELEGRAM_ALLOWED_CHAT_ID: send the bot any message first
// (in the private chat or channel you want it to listen to), then run this.
// Only works while no webhook is registered -- getUpdates and webhooks are
// mutually exclusive. Run `npm run telegram:delete-webhook` first if needed.

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN (reads .env)");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const json = await res.json();

if (!json.ok) {
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}

if (!json.result?.length) {
  console.log("No updates yet. Send the bot a message (or post in the channel), then run this again.");
  process.exit(0);
}

for (const update of json.result) {
  const msg = update.message ?? update.channel_post;
  if (!msg) continue;
  console.log(`chat.id=${msg.chat.id}  type=${msg.chat.type}  title/name=${msg.chat.title ?? msg.chat.username ?? msg.from?.first_name ?? "?"}  text=${JSON.stringify(msg.text ?? "")}`);
}
