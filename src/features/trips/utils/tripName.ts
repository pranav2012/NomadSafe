type Translate = (key: string, params?: Record<string, string | number>) => string;

/** "Lisbon, Portugal" → "Lisbon". */
export function destinationCity(destination: string): string {
  return destination.split(",")[0]?.trim() || destination.trim();
}

/** Localized fallback name: "Lisbon trip", or "Lisbon & more" for several destinations. */
export function defaultTripName(destinations: string[], t: Translate): string {
  if (destinations.length === 0) return "";
  const first = destinationCity(destinations[0]);
  return destinations.length === 1
    ? t("trip.defaultName", { destination: first })
    : t("trip.defaultNameMulti", { first });
}
