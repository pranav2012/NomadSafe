export interface TravelDetails {
  terminal?: string;
  gate?: string;
  platform?: string;
  coach?: string;
  seat?: string;
  boardingAt?: string;
}

export const TRAVEL_FIELDS = ["terminal", "gate", "platform", "coach", "seat"] as const;
export type TravelField = (typeof TRAVEL_FIELDS)[number];

const PATTERNS: Record<TravelField, RegExp> = {
  terminal: /\bterminal\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z]?\d{1,2}[A-Z]?|[A-Z])\b/i,
  gate: /\bgate\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z]{0,2}\d{1,3}[A-Z]?)\b/i,
  platform: /\b(?:platform|track|gleis|voie|binario|andén)\s*(?:no\.?)?\s*[:#]?\s*(\d{1,2}[A-Z]?)\b/i,
  coach: /\b(?:coach|carriage|wagon|wagen|voiture|car no\.?|car number|bogie)\s*[:#]?\s*([A-Z]?\d{1,2}[A-Z]?)\b/i,
  seat: /\b(?:seat|berth|sitzplatz)\s*(?:no\.?|number|s)?\s*[:#]?\s*(\d{1,3}[A-K]?)\b/i,
};
const BOARDING = /\bboarding(?:\s*time)?\s*[:\-]?\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?/i;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Terminal, gate, platform, coach, seat and boarding time when a booking or ticket prints them;
 * `departureAt` (wall clock) gives the boarding time its day. Fields the text doesn't have are left out.
 */
export function travelDetailsFromText(text: string, departureAt?: string): TravelDetails | undefined {
  const details: TravelDetails = {};
  for (const field of TRAVEL_FIELDS) {
    const value = text.match(PATTERNS[field])?.[1];
    if (value) details[field] = value.toUpperCase();
  }
  const boarding = text.match(BOARDING);
  if (boarding && departureAt) {
    let hour = Number(boarding[1]);
    const minute = Number(boarding[2]);
    const meridiem = boarding[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour < 24 && minute < 60) {
      const day = new Date(departureAt);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      // Boarding after departure on the clock means it's the evening before a past-midnight departure.
      if (at.getTime() > day.getTime()) at.setDate(at.getDate() - 1);
      details.boardingAt = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`;
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

/** Fills the gaps in `base` from `extra`; what `base` already has wins. */
export function mergeTravelDetails(base: TravelDetails | undefined, extra: TravelDetails | undefined): TravelDetails | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return { ...extra, ...Object.fromEntries(Object.entries(base).filter(([, value]) => value)) };
}
