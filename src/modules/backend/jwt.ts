import { storage } from "@/modules/storage";
import { authClient } from "./authClient";
import { backendSiteUrl as siteUrl } from "./client";

const STORAGE_KEY = "backend.convex-jwt";

interface CachedJwt {
  token: string;
  expiresAt: number;
  /** Hash of the session cookie it was issued for, so another account never reuses it. */
  session: string;
}

let cachedJwt: CachedJwt | null = null;
let inFlight: Promise<string | null> | null = null;

// FNV-1a; only tells sessions apart, never leaves the phone.
function sessionTag(cookie: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < cookie.length; i++) {
    hash ^= cookie.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function readStored(): CachedJwt | null {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedJwt>;
    return typeof parsed.token === "string" && typeof parsed.expiresAt === "number" && typeof parsed.session === "string"
      ? (parsed as CachedJwt)
      : null;
  } catch {
    return null;
  }
}

function usable(jwt: CachedJwt | null, session: string): jwt is CachedJwt {
  return !!jwt && jwt.session === session && jwt.expiresAt - Date.now() > 60_000;
}

/**
 * Exchanges the stored Better Auth session cookie for a short-lived Convex JWT, for requests made
 * outside the React Convex client (background tasks, streamed HTTP actions). The token is kept in
 * encrypted storage until shortly before it expires, so headless relaunches reuse it.
 */
export async function getConvexJwt(): Promise<string | null> {
  if (!siteUrl) return null;
  const cookie = authClient.getCookie();
  if (!cookie) return null;
  const session = sessionTag(cookie);
  if (usable(cachedJwt, session)) return cachedJwt.token;
  const stored = readStored();
  if (usable(stored, session)) {
    cachedJwt = stored;
    return stored.token;
  }
  inFlight ??= fetchJwt(cookie, session).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchJwt(cookie: string, session: string): Promise<string | null> {
  const res = await fetch(`${siteUrl}/api/auth/convex/token`, {
    headers: { cookie },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) return null;

  let expiresAt = Date.now() + 10 * 60_000;
  try {
    const payload = JSON.parse(atob(body.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (payload.exp) expiresAt = payload.exp * 1000;
  } catch {}
  cachedJwt = { token: body.token, expiresAt, session };
  storage.set(STORAGE_KEY, JSON.stringify(cachedJwt));
  return body.token;
}

export function clearConvexJwt() {
  cachedJwt = null;
  storage.remove(STORAGE_KEY);
}
