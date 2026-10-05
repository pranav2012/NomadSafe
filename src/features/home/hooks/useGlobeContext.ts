import { useEffect, useState } from "react";
import { api, useQuery } from "@/modules/backend";
import { getCurrentPosition, getForegroundPermission, getLastKnownPosition } from "@/modules/location";
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
 * labels for distance and daylight at the focused stop.
 */
export function useGlobeContext(focus: HomeStop | undefined) {
  const { t, formatDistance, formatApproxDuration } = useLocalization();
  const [origin, setOrigin] = useState<HomeStop | null>(null);
  const incoming = useQuery(api.sharing.getIncomingShares) as GlobeContact[] | undefined;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const permission = await getForegroundPermission();
      if (!permission.granted) return;
      const position = (await getLastKnownPosition()) ?? (await getCurrentPosition());
      if (mounted && position) setOrigin({ name: "", latitude: position.latitude, longitude: position.longitude });
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
    distanceLabel = km < 50 ? null : t("home.distanceAway", { distance: formatDistance(km) });
  }

  let daylightLabel: string | null = null;
  if (focus) {
    const place = focus.name.split(",")[0];
    const light = daylightAt(focus.latitude, focus.longitude, now);
    daylightLabel =
      light.hoursUntil === null
        ? t(light.isNight ? "home.polarNight" : "home.midnightSun", { place })
        : t(light.isNight ? "home.nightAt" : "home.dayAt", { place, time: formatApproxDuration(light.hoursUntil) });
  }

  return { origin, contacts, distanceLabel, daylightLabel, isNightAtFocus: focus ? daylightAt(focus.latitude, focus.longitude, now).isNight : false };
}
