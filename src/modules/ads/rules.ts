export const AD_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface AdCheck {
  now: number;
  lastShownAt: number | null;
  firstTrip: boolean;
  loaded: boolean;
}

/** Frequency rules for the trip-created interstitial: never on the first trip, at most once every 4 hours. */
export function canShowAd({ now, lastShownAt, firstTrip, loaded }: AdCheck): boolean {
  if (firstTrip || !loaded) return false;
  return lastShownAt === null || now - lastShownAt >= AD_INTERVAL_MS;
}
