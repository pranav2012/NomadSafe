import { ENTITLEMENT_IDS } from "@convex/billingRules";

export { ENTITLEMENT_IDS };

export const FREE_TRIP_LIMIT = 2;

export type PlanTier = "free" | "plus" | "pro";

export interface PlanState {
  unlimitedTrips: boolean;
  cloudAi: boolean;
}

export const FREE_PLAN: PlanState = { unlimitedTrips: false, cloudAi: false };

export function tierOf(plan: PlanState): PlanTier {
  if (plan.cloudAi) return "pro";
  return plan.unlimitedTrips ? "plus" : "free";
}

/** Plan from the ids of the user's active RevenueCat entitlements. Pro includes unlimited trips. */
export function planFromEntitlements(activeIds: readonly string[]): PlanState {
  const cloudAi = activeIds.includes(ENTITLEMENT_IDS.cloudAi);
  return { cloudAi, unlimitedTrips: cloudAi || activeIds.includes(ENTITLEMENT_IDS.unlimitedTrips) };
}

/** Trips that count toward the free limit: personal trips and shared trips this user owns. */
export function ownedTripCount(trips: readonly { shared?: { role: "owner" | "member" } }[]): number {
  return trips.filter((trip) => !trip.shared || trip.shared.role === "owner").length;
}

export function canCreateTrip(trips: readonly { shared?: { role: "owner" | "member" } }[], plan: PlanState): boolean {
  return plan.unlimitedTrips || ownedTripCount(trips) < FREE_TRIP_LIMIT;
}
