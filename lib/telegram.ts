export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;

export class TelegramClient {
  private readonly apiBase: string;

  constructor(botToken: string) {
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
  }

  /**
   * Splits long text into chunks that fit Telegram's per-message limit,
   * preferring to break on the last newline before the limit so a card's
   * bracket lines don't get sliced mid-line (which would break parseCard
   * if Meera replies to the wrong fragment).
   */
  private chunk(text: string): string[] {
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > TELEGRAM_MESSAGE_LIMIT) {
      const window = rest.slice(0, TELEGRAM_MESSAGE_LIMIT);
      const breakAt = window.lastIndexOf("\n");
      const cut = breakAt > TELEGRAM_MESSAGE_LIMIT * 0.5 ? breakAt : TELEGRAM_MESSAGE_LIMIT;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest.length > 0) chunks.push(rest);
    return chunks;
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    for (const part of this.chunk(text)) {
      const res = await fetch(`${this.apiBase}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: part,
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
      }
    }
  }

  async setWebhook(url: string, secretToken: string): Promise<unknown> {
    const res = await fetch(`${this.apiBase}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        allowed_updates: ["message", "channel_post"],
        drop_pending_updates: true,
      }),
    });
    const json = (await res.json()) as { ok?: boolean };
    if (!res.ok || json.ok === false) {
      throw new Error(`Telegram setWebhook failed: ${JSON.stringify(json)}`);
    }
    return json;
  }

  async deleteWebhook(): Promise<unknown> {
    const res = await fetch(`${this.apiBase}/deleteWebhook`, { method: "POST" });
    return res.json();
  }

  async getWebhookInfo(): Promise<unknown> {
    const res = await fetch(`${this.apiBase}/getWebhookInfo`);
    return res.json();
  }
}
