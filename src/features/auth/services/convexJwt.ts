import { authClient } from "./authClient";

const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

let cachedJwt: { token: string; expiresAt: number } | null = null;

/**
 * Exchanges the stored Better Auth session cookie for a short-lived Convex JWT, for requests made
 * outside the React Convex client (background tasks, streamed HTTP actions).
 */
export async function getConvexJwt(): Promise<string | null> {
  if (cachedJwt && cachedJwt.expiresAt - Date.now() > 60_000) return cachedJwt.token;
  if (!siteUrl) return null;
  const cookie = authClient.getCookie();
  if (!cookie) return null;

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
  cachedJwt = { token: body.token, expiresAt };
  return body.token;
}

export function clearConvexJwt() {
  cachedJwt = null;
}
