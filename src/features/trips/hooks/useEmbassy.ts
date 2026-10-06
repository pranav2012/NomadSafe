import { useEffect } from "react";
import { api, useAction, useConvexAuth } from "@/modules/backend";
import { withAppCheck } from "@/modules/appCheck";
import { logger } from "@/modules/logger";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { useTravelInfoStore, type Embassy } from "@/features/trips/store/travelInfoStore";

const MAX_AGE_MS = 30 * 86_400_000;

/** The home country's embassy in the destination (international trips only); undefined until known. */
export function useEmbassy(home: string | null, destination: string | null): Embassy | null | undefined {
  const lookup = useAction(api.places.embassyFor);
  const { isAuthenticated } = useConvexAuth();
  const key = home && destination && home !== destination ? `${home}:${destination}` : null;
  const entry = useTravelInfoStore((state) => (key ? state.embassies[key] : undefined));
  const setEmbassy = useTravelInfoStore((state) => state.setEmbassy);
  const fetchedAt = entry?.fetchedAt ?? null;

  useEffect(() => {
    if (!key || !home || !destination || !isAuthenticated) return;
    if (fetchedAt !== null && Date.now() - fetchedAt < MAX_AGE_MS) return;
    let cancelled = false;
    withAppCheck({ home, homeName: countryDisplayName(home, "en"), destination, destinationName: countryDisplayName(destination, "en") })
      .then(lookup)
      .then((result) => {
        if (!cancelled) setEmbassy(key, result ? { name: result.name, phone: result.phone, address: result.address, mapsUrl: result.mapsUrl } : null);
      })
      .catch((error: unknown) => logger.warn("travel-info", "embassy lookup failed", error));
    return () => {
      cancelled = true;
    };
  }, [destination, fetchedAt, home, isAuthenticated, key, lookup, setEmbassy]);

  return key ? entry?.embassy : null;
}
