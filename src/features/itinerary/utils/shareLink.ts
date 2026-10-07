const SAVE_LINK = /^(?:[\w.+-]+:\/{1,2}|\/)save-link(?:[/?#]|$)/;

/**
 * The text another app shared, from the iOS Share Extension's `nomadsafe://save-link?url=…&text=…`
 * link (caption first, then the link); null when the path isn't one, "" when it carried nothing.
 */
export function sharedTextFromLink(path: string): string | null {
  if (!SAVE_LINK.test(path)) return null;
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1).split("#")[0] : "";
  const params = new URLSearchParams(query);
  return [params.get("text"), params.get("url")].filter((part): part is string => Boolean(part?.trim())).join(" ").trim();
}
