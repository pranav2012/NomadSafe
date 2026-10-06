const pad = (value: number) => String(value).padStart(2, "0");
const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Wall-clock time at the place, no zone ("2026-10-18T15:00:00"), as booking emails print it. */
export function toWallClock(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

/** Converts an older zoned instant to the phone's wall-clock time; wall-clock values pass through. */
export function normalizeWallClock(value: string): string {
  if (!ZONED.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : toWallClock(date);
}
