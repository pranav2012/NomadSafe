/** Keeps a leading "+" and digits only; null when nothing dialable remains. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** 5–15 digits (E.164 max), optional leading "+". */
export function isValidPhone(phone: string | null | undefined): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const digitCount = normalized.replace("+", "").length;
  return digitCount >= 5 && digitCount <= 15;
}
