export type InviteKind = "group" | "circle";

export interface InviteLink {
  kind: InviteKind;
  code: string;
}

const INVITE_PATH = /(?:^|\/)(join|circle)\/([A-Za-z0-9]{4,16})\/?(?:\?|$)/;

/** Reads the invite from `/join/<code>` or `/circle/<code>` (deep link) paths. */
export function inviteFromPath(path: string): InviteLink | null {
  const match = INVITE_PATH.exec(path);
  if (!match) return null;
  return { kind: match[1] === "circle" ? "circle" : "group", code: match[2].toUpperCase() };
}

/** Reads `join=<code>` or `circle=<code>` from a Play install referrer (`utm_source=...&join=<code>`). */
export function inviteFromReferrer(referrer: string): InviteLink | null {
  const params = new URLSearchParams(referrer);
  const join = params.get("join");
  if (join) return inviteFromPath(`join/${join}`);
  const circle = params.get("circle");
  return circle ? inviteFromPath(`circle/${circle}`) : null;
}

/** Reads the invite from a URL, only if it's on one of our own sites. */
export function inviteFromUrl(url: string, siteUrls: readonly string[]): InviteLink | null {
  try {
    const parsed = new URL(url);
    if (!siteUrls.some((site) => new URL(site).host === parsed.host)) return null;
    return inviteFromPath(parsed.pathname);
  } catch {
    return null;
  }
}
