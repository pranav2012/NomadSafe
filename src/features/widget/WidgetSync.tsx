import { useEffect } from "react";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { syncWidgets } from "@/features/widget/syncWidgets";

/** Keeps home-screen widgets in step with trips and the app language. */
export function WidgetSync() {
  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const { locale } = useLocalization();

  useEffect(() => {
    const timer = setTimeout(() => void syncWidgets(), 400);
    return () => clearTimeout(timer);
  }, [trips, activeTripId, locale]);

  return null;
}
