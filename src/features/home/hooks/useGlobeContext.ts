import { useEffect, useState } from "react";
import * as Location from "expo-location";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useLocalization } from "@/localization";
import type { HomeStop } from "@/features/home/types";
import { daylightAt, distanceKm, sunVector } from "@/features/home/components/aura/globe/sun";
import { formatApproxDuration, formatDistance } from "@/features/home/utils/format";

export interface GlobeContact {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * What the globe shows beyond the route: where you are (only if location is already granted —
 * this never prompts), people sharing their location with you, the sun's position, and short
 * labels for distance and daylight at the focused stop.
 */
export function useGlobeContext(focus: HomeStop | undefined) {
  const { t, locale } = useLocalization();
  const [origin, setOrigin] = useState<HomeStop | null>(null);
  const incoming = useQuery(api.sharing.getIncomingShares) as GlobeContact[] | undefined;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return;
      const position = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({}));
      if (mounted && position) setOrigin({ name: "", latitude: position.coords.latitude, longitude: position.coords.longitude });
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const now = new Date();
  const contacts: GlobeContact[] = (incoming ?? []).map(({ name, latitude, longitude }) => ({ name, latitude, longitude }));

  let distanceLabel: string | null = null;
  if (origin && focus) {
    const km = distanceKm(origin, focus);
    distanceLabel = km < 50 ? null : t("home.distanceAway", { distance: formatDistance(km, locale) });
  }

  let daylightLabel: string | null = null;
  if (focus) {
    const place = focus.name.split(",")[0];
    const light = daylightAt(focus.latitude, focus.longitude, now);
    daylightLabel =
      light.hoursUntil === null
        ? t(light.isNight ? "home.polarNight" : "home.midnightSun", { place })
        : t(light.isNight ? "home.nightAt" : "home.dayAt", { place, time: formatApproxDuration(light.hoursUntil, locale) });
  }

  return { origin, contacts, sun: sunVector(now), distanceLabel, daylightLabel, isNightAtFocus: focus ? daylightAt(focus.latitude, focus.longitude, now).isNight : false };
}
