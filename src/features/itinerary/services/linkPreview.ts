import { logger } from "@/modules/logger";
import type { SharedLink } from "@/features/itinerary/utils/sharedLinks";

export interface LinkPreview {
  title?: string;
  author?: string;
  thumbnail?: string;
}

const TIMEOUT_MS = 6000;
const MAX_HTML_CHARS = 400_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

function decode(value: string) {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#") && code !== "#39") return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** The content of `<meta property|name="key" content="…">`, in either attribute order. */
function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.:]/g, "\\$&");
  const match =
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"));
  return match ? decode(match[1]) || undefined : undefined;
}

async function getWithTimeout(url: string, accept: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: accept }, signal: controller.signal });
    return response.ok ? response : null;
  } finally {
    clearTimeout(timer);
  }
}

async function oEmbed(endpoint: string): Promise<LinkPreview> {
  const response = await getWithTimeout(endpoint, "application/json");
  if (!response) return {};
  const body = (await response.json()) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  return { title: text(body.title), author: text(body.author_name), thumbnail: text(body.thumbnail_url) };
}

/** A shared link's public preview (oEmbed, Open Graph); none for Instagram, which shows it only to Meta's crawlers. Best effort. */
export async function fetchLinkPreview(link: SharedLink): Promise<LinkPreview> {
  try {
    if (link.provider === "instagram") return {};
    if (link.provider === "youtube") return await oEmbed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`);
    if (link.provider === "tiktok") return await oEmbed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link.url)}`);
    const response = await getWithTimeout(link.url, "text/html");
    if (!response || !(response.headers.get("content-type") ?? "").includes("html")) return {};
    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    const title = metaContent(html, "og:title") ?? metaContent(html, "twitter:title") ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]) : undefined);
    const image = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
    return { title, author: metaContent(html, "og:site_name"), thumbnail: image?.startsWith("https://") ? image : undefined };
  } catch (error) {
    logger.warn("link-preview", "failed", error, { provider: link.provider });
    return {};
  }
}
