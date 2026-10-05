import { createRemoteJWKSet, jwtVerify } from "jose";

const APP_CHECK_ISSUER = "https://firebaseappcheck.googleapis.com";
// Module scope so warm isolates reuse the fetched keys.
const jwks = createRemoteJWKSet(new URL(`${APP_CHECK_ISSUER}/v1/jwks`));

type AppCheckMode = "off" | "log" | "enforce";

function appCheckMode(): AppCheckMode {
  const mode = process.env.APP_CHECK_MODE;
  return mode === "log" || mode === "enforce" ? mode : "off";
}

async function verify(token: string | undefined | null): Promise<string | null> {
  if (!token) return "missing token";
  const projectNumber = process.env.FIREBASE_PROJECT_NUMBER;
  if (!projectNumber) return "FIREBASE_PROJECT_NUMBER not set";
  try {
    await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: `${APP_CHECK_ISSUER}/${projectNumber}`,
      audience: `projects/${projectNumber}`,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "invalid token";
  }
}

/**
 * Checks a Firebase App Check token from the app for endpoints that cost us money. APP_CHECK_MODE
 * "off" (default) skips it, "log" only warns, "enforce" throws on a missing or invalid token.
 */
export async function requireAppCheck(token: string | undefined | null): Promise<void> {
  const mode = appCheckMode();
  if (mode === "off") return;
  const failure = await verify(token);
  if (!failure) return;
  if (mode === "log") {
    console.warn("[appCheck] verification failed", failure);
    return;
  }
  throw new Error("App check failed");
}
