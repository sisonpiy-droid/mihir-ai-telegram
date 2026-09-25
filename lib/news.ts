import { XMLParser } from "fast-xml-parser";

export interface NewsItem {
  title: string;
  source: string;
  pubDate: string; // raw RFC-822 string as given by the feed
  link: string;
  description?: string;
}

const RECENCY_WINDOW_DAYS = 45;
const MAX_ITEMS = 8;

function googleNewsUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses a Google News RSS response into NewsItems. Never throws -- any
 * malformed/unexpected XML results in an empty list rather than an error,
 * since news is optional context and must never break the core workflow.
 */
export function parseGoogleNewsRSS(xml: string): NewsItem[] {
  if (!xml || !xml.trim()) return [];
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const doc = parser.parse(xml);
    const rawItems = doc?.rss?.channel?.item;
    const list = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    const items: NewsItem[] = [];
    for (const raw of list) {
      const item = toNewsItem(raw);
      if (item) items.push(item);
    }
    return items;
  } catch (err) {
    console.error("Failed to parse Google News RSS:", err);
    return [];
  }
}

function toNewsItem(raw: unknown): NewsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const rawTitle = typeof r.title === "string" ? r.title : "";
  const title = stripHtml(rawTitle).trim();
  const link = typeof r.link === "string" ? r.link.trim() : "";
  if (!title || !link) return null;

  const pubDate = typeof r.pubDate === "string" ? r.pubDate.trim() : "";

  let source = "";
  const sourceField = r.source;
  if (sourceField && typeof sourceField === "object") {
    const s = sourceField as Record<string, unknown>;
    source = typeof s["#text"] === "string" ? s["#text"].trim() : "";
  } else if (typeof sourceField === "string") {
    source = sourceField.trim();
  }
  if (!source) {
    // Fall back to the "Title - Source" convention Google News titles use.
    const dash = title.lastIndexOf(" - ");
    source = dash !== -1 ? title.slice(dash + 3).trim() : "Unknown source";
  }

  const description = typeof r.description === "string" ? stripHtml(r.description).trim() : "";

  return { title, source, pubDate, link, description: description || undefined };
}

/** Fetches and parses one Google News RSS search. Never throws. */
export async function searchGoogleNews(query: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(googleNewsUrl(query), {
      headers: { "user-agent": "Mozilla/5.0 (compatible; mesa-linkedin-bot/1.0)" },
    });
    if (!res.ok) {
      console.error(`Google News RSS request failed for "${query}": ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return parseGoogleNewsRSS(xml);
  } catch (err) {
    console.error(`Google News RSS request errored for "${query}":`, err);
    return [];
  }
}

function parseDateMs(pubDate: string): number {
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Merges results from multiple queries, dedupes by link, drops anything
 * older than the recency window (when a date is parseable), sorts newest
 * first, and caps the total so the prompt stays small.
 */
export function mergeAndRankNews(resultsByQuery: NewsItem[][], now: number = Date.now()): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  const cutoff = now - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const results of resultsByQuery) {
    for (const item of results) {
      const key = item.link || item.title;
      if (seen.has(key)) continue;
      const ms = parseDateMs(item.pubDate);
      if (ms && ms < cutoff) continue; // too old
      seen.add(key);
      merged.push(item);
    }
  }

  merged.sort((a, b) => parseDateMs(b.pubDate) - parseDateMs(a.pubDate));
  return merged.slice(0, MAX_ITEMS);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deliberately not toLocaleDateString: its abbreviated-month output for
// en-GB ("Sept" vs "Sep") depends on the runtime's ICU data, which can
// differ between local dev and the deployed Vercel function.
export function formatNewsDate(pubDate: string): string {
  const ms = parseDateMs(pubDate);
  if (!ms) return pubDate || "date unknown";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** One display/citation line: "title" - source, date - url */
export function formatSourceLine(item: NewsItem): string {
  return `"${item.title}" - ${item.source}, ${formatNewsDate(item.pubDate)} - ${item.link}`;
}
