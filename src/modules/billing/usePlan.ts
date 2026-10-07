import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { track } from "@/modules/analytics";
import { usePlanStore } from "./planStore";
import { canCreateGroup, canCreatePlannedTrip, canCreateTrip, tierOf } from "./plan";

export function usePlan() {
  const unlimitedTrips = usePlanStore((s) => s.unlimitedTrips);
  const cloudAi = usePlanStore((s) => s.cloudAi);
  const billingAvailable = usePlanStore((s) => s.billingAvailable);
  const lifetime = usePlanStore((s) => s.lifetime);
  return { unlimitedTrips, cloudAi, billingAvailable, lifetime, tier: tierOf({ unlimitedTrips, cloudAi }) };
}

/**
 * Opens trip planning; a free user at the trip limit can still start a planned trip (it's
 * confirmed later), and gets the paywall only when planned trips are used up too.
 */
export function useStartNewTrip() {
  const router = useRouter();
  return useCallback((fromGroupId?: string) => {
    const plan = usePlanStore.getState();
    const { trips, plannedTrips } = useTripsStore.getState();
    if (canCreateTrip(trips, plan)) {
      router.push(fromGroupId ? { pathname: "/plan-trip", params: { fromGroup: fromGroupId } } : "/plan-trip");
      return;
    }
    if (!fromGroupId && canCreatePlannedTrip(plannedTrips, plan)) {
      router.push({ pathname: "/plan-trip", params: { plannedOnly: "1" } });
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

export type PlusFeature = "shares" | "presets" | "recurring" | "charts" | "export" | "receiptScan";

/** Plus extras: `run(feature, action)` runs it on Plus or Pro, else opens the paywall for that feature. */
export function usePlusGate() {
  const router = useRouter();
  const isPlus = usePlanStore((s) => s.unlimitedTrips);
  const run = useCallback(
    (feature: PlusFeature, action: () => void) => {
      if (usePlanStore.getState().unlimitedTrips) {
        action();
        return;
      }
      track("plus_feature_blocked", { feature });
      router.push({ pathname: "/paywall", params: { reason: "plus", feature } });
    },
    [router],
  );
  return { isPlus, run };
}

