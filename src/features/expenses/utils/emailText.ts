/** Longest email text kept on a stored spend or booking (its rawText and note). */
export const MAX_STORED_EMAIL_CHARS = 2000;

/** Keeps the start of an email's text, cut at a code point boundary with an ellipsis. */
export function trimStoredEmailText(text: string, max = MAX_STORED_EMAIL_CHARS): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Trims the email text kept on a stored record; other sources are left alone. */
export function trimStoredEmailRecord<T extends { source?: string; rawText?: string; note?: string }>(record: T): T {
  if (record.source !== "email") return record;
  const rawText = record.rawText === undefined ? undefined : trimStoredEmailText(record.rawText);
  const note = record.note === undefined ? undefined : trimStoredEmailText(record.note);
  if (rawText === record.rawText && note === record.note) return record;
  return { ...record, ...(rawText !== undefined && { rawText }), ...(note !== undefined && { note }) };
}
