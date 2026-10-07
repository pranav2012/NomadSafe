export type LinkProvider = "instagram" | "tiktok" | "youtube" | "web";

export interface SharedLink {
  /** Canonical form: tracking parameters dropped, so the same reel shared twice matches. */
  url: string;
  provider: LinkProvider;
  /** Reels, TikToks and YouTube videos/Shorts play in the app; other links open in the browser. */
  video: boolean;
  /** Account name when the URL carries it (TikTok "@name", Instagram "/name/reel/…"). */
  author?: string;
  youtubeId?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'）)]+/i;
const INSTAGRAM_PATH = /^\/(?:([\w.]+)\/)?(reel|reels|p|tv)\/([\w-]+)/;
const TIKTOK_VIDEO = /^\/@([\w.]+)\/(?:video|photo)\/(\d+)/;
const YOUTUBE_ID = /^[\w-]{11}$/;

/** The first web link in shared text (a caption with a link in it, or the link alone). */
export function extractLink(text: string): string | null {
  const match = text.match(URL_PATTERN);
  return match ? match[0].replace(/[.,!?;:]+$/, "") : null;
}

/** What a shared web link is, in canonical form; null for anything that isn't http(s). */
export function classifyLink(raw: string): SharedLink | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^(www|m|mobile)\./, "").toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "");

  if (host === "instagram.com" || host === "instagr.am") {
    const match = path.match(INSTAGRAM_PATH);
    if (match) {
      const kind = match[2] === "reels" ? "reel" : match[2];
      return { url: `https://www.instagram.com/${kind}/${match[3]}/`, provider: "instagram", video: kind !== "p", ...(match[1] ? { author: match[1] } : {}) };
    }
    return { url: `https://www.instagram.com${path}/`, provider: "instagram", video: false };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const match = path.match(TIKTOK_VIDEO);
    if (match) return { url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`, provider: "tiktok", video: true, author: match[1] };
    // Short links (vm.tiktok.com/…) are resolved by TikTok's own preview.
    return { url: `https://${host}${path}`, provider: "tiktok", video: true };
  }
  if (host === "youtu.be" || host === "youtube.com" || host === "music.youtube.com") {
    const id = host === "youtu.be" ? path.slice(1) : path.startsWith("/shorts/") ? path.slice(8) : path.startsWith("/live/") ? path.slice(6) : (parsed.searchParams.get("v") ?? "");
    if (YOUTUBE_ID.test(id)) {
      return { url: path.startsWith("/shorts/") ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`, provider: "youtube", video: true, youtubeId: id };
    }
  }
  const query = [...parsed.searchParams].filter(([key]) => !/^(utm_|fbclid|gclid|igsh|si$|ref$|ref_src)/i.test(key));
  const search = query.length > 0 ? `?${new URLSearchParams(query).toString()}` : "";
  return { url: `${parsed.protocol}//${parsed.host}${parsed.pathname}${search}`, provider: "web", video: false };
}

/** Shared text minus the link itself: the caption, if the app sent one. */
export function captionOf(text: string, link: string | null): string {
  return (link ? text.replace(link, "") : text).replace(/\s+/g, " ").trim();
}

export type LinkEmbed = { kind: "page"; uri: string } | { kind: "youtube"; id: string };

/**
 * How to play a saved link in the app: Instagram and TikTok embed pages, or a YouTube id (its player
 * needs a page around it). Null when there's no embed (TikTok short links, other sites): open it instead.
 */
export function embedFor(link: { url: string; provider: LinkProvider }): LinkEmbed | null {
  const classified = classifyLink(link.url);
  if (!classified) return null;
  if (classified.provider === "youtube" && classified.youtubeId) return { kind: "youtube", id: classified.youtubeId };
  const path = new URL(classified.url).pathname;
  const instagram = classified.provider === "instagram" ? path.match(/^\/(reel|p|tv)\/([\w-]+)/) : null;
  if (instagram) return { kind: "page", uri: `https://www.instagram.com/${instagram[1]}/${instagram[2]}/embed/` };
  const tiktok = classified.provider === "tiktok" ? path.match(/\/video\/(\d+)/) : null;
  if (tiktok) return { kind: "page", uri: `https://www.tiktok.com/embed/v2/${tiktok[1]}` };
  return null;
}
