import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: ["media:content", "media:thumbnail", "description", "content:encoded", "enclosure", "itunes:image"]
  }
});

/**
 * Extract image URL from HTML content (looks for <img> tags)
 */
function extractImageFromHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  // Match <img src="..."> or <img ... src="...">
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) {
    const src = imgMatch[1];
    // Filter out tracking pixels, icons, and data URIs
    if (src.startsWith("data:")) return undefined;
    if (src.includes("pixel") || src.includes("tracker") || src.includes("1x1")) return undefined;
    if (src.includes(".gif") && !src.includes("giphy")) return undefined; // Skip tiny gifs except giphy
    return src;
  }
  return undefined;
}

const REQUEST_TIMEOUT_MS = 12_000;
const APP_WEB_URL = process.env.APP_WEB_URL?.trim() || "https://chainshorts.live";

export interface RssEntry {
  id: string;
  link: string;
  title: string;
  pubDate: string;
  description?: string;
  content?: string;
  imageUrl?: string;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function fetchFeedXml(feedUrl: string): Promise<string> {
  // AbortSignal.timeout covers both connection AND body read — no manual clearTimeout needed.
  // The previous manual AbortController cleared the timer before response.text() completed,
  // leaving body reads unguarded and hanging indefinitely on slow/stalled RSS servers.
  const response = await fetch(feedUrl, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": `chainshorts-ingest/1.0 (+${APP_WEB_URL})`,
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"
    }
  });

  if (!response.ok) {
    throw new Error(`Feed fetch failed (${response.status})`);
  }

  return response.text();
}

export async function fetchRssEntries(feedUrl: string): Promise<RssEntry[]> {
  if (!feedUrl.startsWith("https://")) {
    throw new Error(`RSS feed must use HTTPS: ${feedUrl}`);
  }
  const xml = await fetchFeedXml(feedUrl);
  const feed = await parser.parseString(xml);

  return (feed.items ?? [])
    .map((item) => {
      const normalizedItem = item as unknown as Record<string, unknown> & {
        guid?: string;
        id?: string;
        link?: string;
        title?: string;
        pubDate?: string;
        contentSnippet?: string;
        content?: string;
      };

      const media = normalizedItem["media:content"] as { $?: { url?: string } } | undefined;
      const thumb = normalizedItem["media:thumbnail"] as { $?: { url?: string } } | undefined;
      const enclosure = normalizedItem["enclosure"] as { $?: { url?: string; type?: string } } | { url?: string; type?: string } | undefined;
      const itunesImage = normalizedItem["itunes:image"] as { $?: { href?: string } } | undefined;

      // Try multiple image sources in order of preference
      let imageUrl: string | undefined =
        media?.$?.url ??
        thumb?.$?.url ??
        (enclosure && "$" in enclosure ? enclosure.$?.url : (enclosure as { url?: string })?.url) ??
        itunesImage?.$?.href ??
        undefined;

      // If no image found, try extracting from HTML content
      if (!imageUrl) {
        const htmlContent = normalizedItem.content ?? normalizedItem.description ?? normalizedItem["content:encoded"];
        imageUrl = extractImageFromHtml(typeof htmlContent === "string" ? htmlContent : undefined);
      }

      // Validate image URL
      if (imageUrl) {
        try {
          const url = new URL(imageUrl);
          if (!url.protocol.startsWith("http")) imageUrl = undefined;
        } catch {
          imageUrl = undefined;
        }
      }

      return {
        id: normalizedItem.guid ?? normalizedItem.id ?? normalizedItem.link ?? normalizedItem.title ?? "",
        link: normalizedItem.link ?? "",
        title: normalizedItem.title ?? "",
        pubDate: normalizedItem.pubDate ?? new Date().toISOString(),
        description: toOptionalString(normalizedItem.contentSnippet ?? normalizedItem.description ?? normalizedItem.content),
        content: toOptionalString(normalizedItem.content),
        imageUrl
      } satisfies RssEntry;
    })
    .filter((entry) => {
      if (!entry.id || !entry.link || !entry.title) return false;
      // Skip entries where the link is just the site homepage
      try {
        const parsed = new URL(entry.link);
        if (parsed.pathname === "/" || parsed.pathname === "") return false;
      } catch {
        return false;
      }
      return true;
    });
}
