import { useEffect, useState } from "react";
import { api, useQuery } from "@/modules/backend";
import { getForegroundPermission, getLastKnownPosition, getRecentPosition } from "@/modules/location";
import { useAppActive } from "@/hooks/useAnimationsActive";
import { useNow } from "@/hooks/useNow";
import { useLastLoaded } from "@/features/location-sharing/hooks/useSharingQueries";
import { useLocalization } from "@/localization";
import type { HomeStop } from "@/features/home/types";
import { daylightAt, distanceKm } from "@/features/home/components/aura/globe/sun";

export interface GlobeContact {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * What the globe shows beyond the route: where you are (only if location is already granted —
 * this never prompts), people sharing their location with you, and short
 * labels for distance and daylight at the focused stop. Pass `now` when the caller already ticks a clock.
 */
export function useGlobeContext(focus: HomeStop | undefined, now?: Date) {
  const { t, formatDistance, formatApproxDuration } = useLocalization();
  const [origin, setOrigin] = useState<HomeStop | null>(null);
  const ownNow = useNow(now === undefined);
  const appActive = useAppActive();
  // Paused in the background; the last contacts stay on the globe.
  const incoming = useLastLoaded(
    useQuery(api.sharing.getIncomingShares, appActive ? {} : "skip") as
      | { ownerName: string; latitude: number; longitude: number }[]
      | undefined,
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      const permission = await getForegroundPermission();
      if (!permission.granted) return;
      // Any cached fix will do for a globe; a fresh one is shared with other screens asking at launch.
      const position = (await getLastKnownPosition()) ?? (await getRecentPosition("balanced"));
      if (mounted && position) setOrigin({ name: "", latitude: position.latitude, longitude: position.longitude });
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const at = now ?? ownNow;
  const contacts: GlobeContact[] = (incoming ?? []).map(({ ownerName, latitude, longitude }) => ({ name: ownerName, latitude, longitude }));

  let distanceLabel: string | null = null;
  if (origin && focus) {
    const km = distanceKm(origin, focus);
    distanceLabel = km < 50 ? null : t("home.distanceAway", { distance: formatDistance(km) });
  }

  let daylightLabel: string | null = null;
  if (focus) {
    const place = focus.name.split(",")[0];
    const light = daylightAt(focus.latitude, focus.longitude, at);
    daylightLabel =
      light.hoursUntil === null
        ? t(light.isNight ? "home.polarNight" : "home.midnightSun", { place })
        : t(light.isNight ? "home.nightAt" : "home.dayAt", { place, time: formatApproxDuration(light.hoursUntil) });
  }

  return { origin, contacts, distanceLabel, daylightLabel, isNightAtFocus: focus ? daylightAt(focus.latitude, focus.longitude, at).isNight : false };
}
