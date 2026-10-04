import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { track } from "@/services/analytics";
import { usePlanStore } from "../store/planStore";
import { canCreateTrip, tierOf } from "../utils/plan";

export function usePlan() {
  const unlimitedTrips = usePlanStore((s) => s.unlimitedTrips);
  const cloudAi = usePlanStore((s) => s.cloudAi);
  const billingAvailable = usePlanStore((s) => s.billingAvailable);
  return { unlimitedTrips, cloudAi, billingAvailable, tier: tierOf({ unlimitedTrips, cloudAi }) };
}

/** Opens trip planning, or the paywall when a free user already owns the maximum number of trips. */
export function useStartNewTrip() {
  const router = useRouter();
  return useCallback(() => {
    const plan = usePlanStore.getState();
    if (canCreateTrip(useTripsStore.getState().trips, plan)) {
      router.push("/plan-trip");
      return;
    }
    track("trip_limit_reached");
    router.push({ pathname: "/paywall", params: { reason: "trips" } });
  }, [router]);
}
