import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { track } from "@/modules/analytics";
import { usePlanStore } from "./planStore";
import { canCreateGroup, canCreateTrip, tierOf } from "./plan";

export function usePlan() {
  const unlimitedTrips = usePlanStore((s) => s.unlimitedTrips);
  const cloudAi = usePlanStore((s) => s.cloudAi);
  const billingAvailable = usePlanStore((s) => s.billingAvailable);
  const lifetime = usePlanStore((s) => s.lifetime);
  return { unlimitedTrips, cloudAi, billingAvailable, lifetime, tier: tierOf({ unlimitedTrips, cloudAi }) };
}

/** Opens trip planning, or the paywall when a free user already owns the maximum number of trips. */
export function useStartNewTrip() {
  const router = useRouter();
  return useCallback((fromGroupId?: string) => {
    const plan = usePlanStore.getState();
    if (canCreateTrip(useTripsStore.getState().trips, plan)) {
      router.push(fromGroupId ? { pathname: "/plan-trip", params: { fromGroup: fromGroupId } } : "/plan-trip");
      return;
    }
    track("trip_limit_reached");
    router.push({ pathname: "/paywall", params: { reason: "trips" } });
  }, [router]);
}

/** Runs `create` (e.g. opens the new-group sheet), or the paywall when a free user already owns the maximum number of groups. */
export function useStartNewGroup() {
  const router = useRouter();
  return useCallback(
    (create: () => void) => {
      if (canCreateGroup(useTripsStore.getState().groups, usePlanStore.getState())) {
        create();
        return;
      }
      track("group_limit_reached");
      router.push({ pathname: "/paywall", params: { reason: "groups" } });
    },
    [router],
  );
}
