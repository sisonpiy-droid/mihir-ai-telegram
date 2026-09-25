// Unit tests for lib/news.ts -- pure parsing/ranking logic, no network.
// Run with: npm run test:news

import { parseGoogleNewsRSS, mergeAndRankNews, formatSourceLine, formatNewsDate, type NewsItem } from "../lib/news.js";

let failures = 0;
function assert(condition: unknown, message: string): void {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

const NOW = Date.parse("2026-09-25T00:00:00Z");

function rssWith(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test</title>${items}</channel></rss>`;
}

const VALID_ITEM = `<item>
  <title>Skincare brands rethink formulas for humidity - Economic Times</title>
  <link>https://news.google.com/rss/articles/abc123?oc=5</link>
  <guid isPermaLink="false">abc123</guid>
  <pubDate>Wed, 24 Sep 2026 10:00:00 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/abc123?oc=5"&gt;Skincare brands rethink formulas for humidity&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Economic Times&lt;/font&gt;</description>
  <source url="https://economictimes.indiatimes.com">Economic Times</source>
</item>`;

// 1. Source extraction from a well-formed item.
{
  const items = parseGoogleNewsRSS(rssWith(VALID_ITEM));
  assert(items.length === 1, "valid RSS -> one item parsed");
  const item = items[0];
  assert(item?.title === "Skincare brands rethink formulas for humidity - Economic Times", "source extraction -> title");
  assert(item?.source === "Economic Times", "source extraction -> source from <source> tag");
  assert(item?.link === "https://news.google.com/rss/articles/abc123?oc=5", "source extraction -> link");
  assert(item?.pubDate === "Wed, 24 Sep 2026 10:00:00 GMT", "source extraction -> pubDate");
  assert(!!item?.description && !item.description.includes("<") && !item.description.includes("&amp;"), "source extraction -> description HTML stripped");
}

// 2. Source extraction falls back to "Title - Source" when <source> is absent.
{
  const noSourceTag = `<item>
    <title>Some headline - chandigarhmetro.com</title>
    <link>https://news.google.com/rss/articles/def456</link>
    <pubDate>Thu, 17 Sep 2026 10:51:13 GMT</pubDate>
  </item>`;
  const items = parseGoogleNewsRSS(rssWith(noSourceTag));
  assert(items.length === 1 && items[0].source === "chandigarhmetro.com", "missing <source> tag -> falls back to title suffix");
}

// 3. An item missing a link is dropped rather than crashing.
{
  const noLink = `<item><title>No link here</title><pubDate>Thu, 17 Sep 2026 10:51:13 GMT</pubDate></item>`;
  const items = parseGoogleNewsRSS(rssWith(noLink));
  assert(items.length === 0, "item without a link -> dropped, not crashed");
}

// 4. Malformed RSS never throws -- returns an empty list.
{
  const malformedInputs = ["<rss><channel><item><title>unclosed", "not xml at all {{{", "", "   ", "<html>wrong format entirely</html>"];
  let anyThrew = false;
  for (const input of malformedInputs) {
    try {
      const items = parseGoogleNewsRSS(input);
      assert(Array.isArray(items), `malformed input "${input.slice(0, 20)}..." -> returns an array, no throw`);
    } catch {
      anyThrew = true;
    }
  }
  assert(!anyThrew, "no malformed input caused parseGoogleNewsRSS to throw");
}

// 5. mergeAndRankNews dedupes by link across queries and sorts newest first.
{
  const older: NewsItem = { title: "Older", source: "A", pubDate: "Mon, 01 Sep 2026 00:00:00 GMT", link: "https://x/1" };
  const newer: NewsItem = { title: "Newer", source: "B", pubDate: "Wed, 24 Sep 2026 00:00:00 GMT", link: "https://x/2" };
  const dupe: NewsItem = { title: "Newer (dup)", source: "B", pubDate: "Wed, 24 Sep 2026 00:00:00 GMT", link: "https://x/2" };
  const merged = mergeAndRankNews([[older, newer], [dupe]], NOW);
  assert(merged.length === 2, "mergeAndRankNews -> dedupes by link across query result sets");
  assert(merged[0].link === "https://x/2", "mergeAndRankNews -> newest first");
}

// 6. mergeAndRankNews drops items clearly outside the recency window.
{
  const stale: NewsItem = { title: "Very old", source: "A", pubDate: "Mon, 01 Jan 2024 00:00:00 GMT", link: "https://x/stale" };
  const fresh: NewsItem = { title: "Fresh", source: "B", pubDate: "Mon, 22 Sep 2026 00:00:00 GMT", link: "https://x/fresh" };
  const merged = mergeAndRankNews([[stale, fresh]], NOW);
  assert(merged.length === 1 && merged[0].link === "https://x/fresh", "mergeAndRankNews -> drops stale items outside the recency window");
}

// 7. No news available -- an empty result set list stays empty, no crash.
{
  const merged = mergeAndRankNews([[], []], NOW);
  assert(Array.isArray(merged) && merged.length === 0, "no news available -> empty array, not an error");
}

// 8. formatSourceLine / formatNewsDate produce a stable, parseable line.
{
  const item: NewsItem = {
    title: "Example headline",
    source: "Example Source",
    pubDate: "Wed, 24 Sep 2026 10:00:00 GMT",
    link: "https://example.com/a",
  };
  const line = formatSourceLine(item);
  assert(line === '"Example headline" - Example Source, 24 Sep 2026 - https://example.com/a', "formatSourceLine -> expected format");
  assert(formatNewsDate("not a real date") === "not a real date", "formatNewsDate -> falls back to raw string when unparseable");
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
