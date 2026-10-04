export interface OpeningHours {
  utcOffsetMinutes: number;
  /** [open, close] minutes from Sunday 00:00 place-local; a null close means always open. */
  windows: [number, number | null][];
}

const WEEK = 7 * 24 * 60;

/** Whether a place is open at `now`, from its weekly hours in its own time zone. */
export function isOpenAt(hours: OpeningHours, now: number) {
  const local = new Date(now + hours.utcOffsetMinutes * 60_000);
  const minute = (local.getUTCDay() * 24 + local.getUTCHours()) * 60 + local.getUTCMinutes();
  return hours.windows.some(([open, close]) => {
    if (close === null) return true;
    const end = close > open ? close : close + WEEK;
    return (minute >= open && minute < end) || (minute + WEEK >= open && minute + WEEK < end);
  });
}
