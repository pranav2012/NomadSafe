const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar day ("YYYY-MM-DD") for a Date or ISO string; date-only keys pass through. */
export function toLocalDayKey(value: Date | string): string {
  if (typeof value === "string" && DATE_KEY.test(value)) return value;
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses a "YYYY-MM-DD" key (or the date part of an ISO string) as local midnight. */
export function fromLocalDayKey(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}
