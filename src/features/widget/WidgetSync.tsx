import { useEffect } from "react";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useSettingsStore } from "@/features/settings";
import { useLocalization } from "@/localization";
import { syncWidgets } from "@/features/widget/syncWidgets";

/** Keeps home-screen widgets in step with trips, the app language and the theme. */
export function WidgetSync() {
  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const themeMode = useSettingsStore((state) => state.themeMode);
  const { locale } = useLocalization();

  useEffect(() => {
    const timer = setTimeout(() => void syncWidgets(), 400);
    return () => clearTimeout(timer);
  }, [trips, activeTripId, locale, themeMode]);

  return null;
}
