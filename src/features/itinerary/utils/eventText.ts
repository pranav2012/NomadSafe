type Translate = (key: string, params?: Record<string, string | number>) => string;

// Email-imported events store these canonical English strings (they feed the
// dedupe fingerprint), so they're translated only when displayed.
const DEFAULT_TITLES: Record<string, string> = {
  "Hotel stay": "itinerary.defaults.hotelStay",
  Flight: "itinerary.defaults.flight",
  Activity: "itinerary.defaults.activity",
};

const DETAIL_PREFIXES: Record<string, string> = {
  "Check-in": "itinerary.defaults.checkIn",
  "Check-out": "itinerary.defaults.checkOut",
  Departure: "itinerary.defaults.departure",
  Arrival: "itinerary.defaults.arrival",
};

export function localizeEventTitle(title: string, t: Translate): string {
  const key = DEFAULT_TITLES[title];
  return key ? t(key) : title;
}

/** Translates a leading "Departure"/"Check-in"/… label, keeping any " · BKK → HKT" suffix. */
export function localizeEventDetail(detail: string | undefined, t: Translate): string | undefined {
  if (!detail) return detail;
  const [head, ...rest] = detail.split(" · ");
  const key = DETAIL_PREFIXES[head];
  return key ? [t(key), ...rest].join(" · ") : detail;
}
