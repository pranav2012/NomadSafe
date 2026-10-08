/** Extracts the code from `/join/<code>` (deep link) paths. */
export function inviteCodeFromPath(path: string): string | null {
  const match = /(?:^|\/)join\/([A-Za-z0-9]{4,16})\/?(?:\?|$)/.exec(path);
  return match ? match[1].toUpperCase() : null;
}

/** Reads `join=<code>` from a Play install referrer (`utm_source=...&join=<code>`). */
export function inviteCodeFromReferrer(referrer: string): string | null {
  const join = new URLSearchParams(referrer).get("join");
  return join ? inviteCodeFromPath(`join/${join}`) : null;
}

/** Reads the code from an invite URL, only if it's on one of our own sites. */
export function inviteCodeFromUrl(url: string, siteUrls: readonly string[]): string | null {
  try {
    const parsed = new URL(url);
    if (!siteUrls.some((site) => new URL(site).host === parsed.host)) return null;
    return inviteCodeFromPath(parsed.pathname);
  } catch {
    return null;
  }
}
