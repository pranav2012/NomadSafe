import * as Crypto from "expo-crypto";
import { storage } from "@/modules/storage";

const TOKEN_KEY = "widget.linkToken";
export const WIDGET_TOKEN_PARAM = "t";

/** This install's secret for widget links (created on first use), so other apps can't arm SOS or the mic. */
export function getWidgetToken(): string {
  const existing = storage.getString(TOKEN_KEY);
  if (existing) return existing;
  const token = Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
  storage.set(TOKEN_KEY, token);
  return token;
}

/** Compares a link's token with this install's in constant time (for equal lengths). */
export function isWidgetToken(candidate: string | null | undefined): boolean {
  const expected = storage.getString(TOKEN_KEY);
  if (!candidate || !expected || candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Links come from other apps too, so malformed escapes must not throw.
function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function splitQuery(path: string): [string, string[]] {
  const at = path.indexOf("?");
  if (at < 0) return [path, []];
  return [path.slice(0, at), path.slice(at + 1).split("&").filter(Boolean)];
}

/** A query parameter of a deep link path (`nomadsafe://x?a=1` or `/x?a=1`). */
export function linkParam(path: string, name: string): string | null {
  for (const pair of splitQuery(path)[1]) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (decode(key) === name) return eq < 0 ? "" : decode(pair.slice(eq + 1));
  }
  return null;
}

export function withoutLinkParams(path: string, names: string[]): string {
  const [base, pairs] = splitQuery(path);
  const kept = pairs.filter((pair) => !names.includes(decode(pair.split("=")[0])));
  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}
