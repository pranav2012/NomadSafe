import type { TransitMode } from "@/features/itinerary/constants/eventTypes";

// Checked in order: train and bus bookings also say "boarding" or "PNR", so they go before flights.
const MODE_PATTERNS: [TransitMode, RegExp][] = [
  ["ferry", /\b(?:ferry|ferries|boat|cruise|catamaran|speedboat)\b/i],
  ["train", /\b(?:train|trains|rail|railway|railways|shinkansen|irctc|amtrak|eurostar|sncf|trenitalia|renfe|bahn|tgv|vande bharat|rajdhani|shatabdi)\b/i],
  ["bus", /\b(?:bus|buses|coach|redbus|flixbus|greyhound|megabus|shuttle)\b/i],
  ["car", /\b(?:car rental|rental car|rent a car|hertz|avis|sixt|europcar|taxi|cab|uber|ola|road trip)\b/i],
  ["flight", /\b(?:flight|flights|airline|airlines|airways|airport|plane|boarding pass|e-ticket)\b/i],
];

// A bare flight number such as "JL754" or "6E 2134", the title the booking parser gives flights.
const FLIGHT_NUMBER = /^\s*(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{1,4}\s*$/;
// Two airport codes, "BLR → NRT": only flights are written like this.
const AIRPORT_ROUTE = /^\s*[A-Z]{3}\s*(?:→|->|–|-|to)\s*[A-Z]{3}\b/;

/** Best guess at how a transit event travels, from its title and detail; undefined when nothing matches. */
export function inferTransitMode(title: string, detail?: string): TransitMode | undefined {
  if (FLIGHT_NUMBER.test(title) || AIRPORT_ROUTE.test(detail ?? "")) return "flight";
  const text = `${title} ${detail ?? ""}`;
  return MODE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
}

/** The stored mode, else a guess from the text, for transit events only. */
export function transitModeOf(event: { type: string; title: string; detail?: string; transitMode?: TransitMode }): TransitMode | undefined {
  if (event.type !== "transit") return undefined;
  return event.transitMode ?? inferTransitMode(event.title, event.detail);
}

const ROUTE_SEPARATOR = /\s*(?:→|->|⇒|–|—|\s-\s|\bto\b)\s*/i;
const MAX_PLACE_LENGTH = 60;

function cleanPlace(value: string): string {
  return value.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/** The two ends of a route such as "Hoi An → Hue" or "BLR - NRT"; null when the text isn't a route. */
export function parseRouteEnds(text: string | undefined): [string, string] | null {
  if (!text) return null;
  const head = text.split(" · ")[0];
  const parts = head.split(ROUTE_SEPARATOR);
  if (parts.length !== 2) return null;
  const from = cleanPlace(parts[0]);
  const to = cleanPlace(parts[1]);
  if (!from || !to || from.length > MAX_PLACE_LENGTH || to.length > MAX_PLACE_LENGTH) return null;
  if (from.toLocaleLowerCase() === to.toLocaleLowerCase()) return null;
  return [from, to];
}
