// No Convex imports, so tests can load this file directly.

export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 10;
// Codes made before the switch to 10 characters are 8 long and keep working.
const INVITE_CODE_RE = /^[A-Z0-9]{8,16}$/;
const EXPO_PUSH_TOKEN_RE = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
export const MAX_PUSH_TOKEN_LENGTH = 200;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Uniform random invite code; rejection sampling keeps every character equally likely for any alphabet size. */
export function newInviteCode(
  length = INVITE_CODE_LENGTH,
  alphabet = INVITE_CODE_ALPHABET,
  fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
) {
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < length) {
    for (const byte of fill(new Uint8Array(length * 2))) {
      if (byte >= limit) continue;
      code += alphabet[byte % alphabet.length];
      if (code.length === length) break;
    }
  }
  return code;
}

export function normalizeInviteCode(code: string) {
  const normalized = code.trim().toUpperCase();
  return INVITE_CODE_RE.test(normalized) ? normalized : null;
}

export function isExpoPushToken(token: string) {
  return token.length <= MAX_PUSH_TOKEN_LENGTH && EXPO_PUSH_TOKEN_RE.test(token);
}

/** Compares secrets without returning early on the first differing byte. */
export function constantTimeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

/** A client edit time, capped at a few minutes ahead so a skewed or hostile clock can't win every future write. */
export function clampClientTime(value: number, now: number) {
  if (!Number.isFinite(value)) throw new Error("Invalid timestamp");
  return Math.min(value, now + MAX_CLOCK_SKEW_MS);
}

export function isValidCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export function assertMaxLength(value: string | undefined | null, max: number, field: string) {
  if (value != null && value.length > max) throw new Error(`${field} is too long (max ${max} characters)`);
}

export function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Drops the note from email-imported records: it holds the email text, which stays on the phone. */
export function stripEmailNote(data: unknown) {
  if (!data || typeof data !== "object" || (data as { source?: unknown }).source !== "email") return data;
  const { note: _note, ...rest } = data as Record<string, unknown>;
  return rest;
}
