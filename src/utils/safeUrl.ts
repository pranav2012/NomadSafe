const MAPS_HOSTS = /^(?:[\w-]+\.)*(?:google\.[a-z]{2,3}(?:\.[a-z]{2})?|goo\.gl)$/i;

/** Whether a server- or user-supplied link is an https Google Maps URL, safe to hand to `Linking.openURL`. */
export function isSafeMapsUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const match = /^https:\/\/([^/?#:@]+)(?:[/?#]|$)/i.exec(url.trim());
  return match !== null && MAPS_HOSTS.test(match[1]);
}
