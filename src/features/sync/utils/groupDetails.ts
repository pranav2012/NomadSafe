import type { MoneyGroup, Shareable, SharedGroupInfo } from "@/features/trips/store/tripsStore";

/** The fields everyone shares; people are members, and ids differ per phone. Groups and planned trips say their `kind`. */
export function groupDetails(trip: Shareable) {
  if (trip.kind === "planned") {
    return { kind: "planned" as const, name: trip.name, destinations: trip.destinations, destinationCoordinates: trip.destinationCoordinates, month: trip.month, createdAt: trip.createdAt };
  }
  if (trip.kind === "group") {
    return { kind: "group" as const, name: trip.name, emoji: trip.emoji, budget: trip.budget, currency: trip.currency, createdAt: trip.createdAt, smartSplit: trip.smartSplit };
  }
  return {
    name: trip.name,
    destinations: trip.destinations,
    destinationCoordinates: trip.destinationCoordinates,
    startDate: trip.startDate,
    endDate: trip.endDate,
    budget: trip.budget,
    currency: trip.currency,
    createdAt: trip.createdAt,
    smartSplit: trip.smartSplit,
  };
}

/**
 * A local trip, group or planned trip updated from the server: newer details (if any), members and
 * preferences. When the owner confirms a planned trip, its details arrive as a trip's, and the
 * local copy turns into that trip (same id), dropping the planned-only fields.
 */
export function mergeDetails(local: Shareable, details: ReturnType<typeof groupDetails> | null, companions: string[], shared: SharedGroupInfo): Shareable {
  if (details && local.kind === "planned" && details.kind !== "planned") {
    const { kind: _kind, month: _month, ...rest } = local;
    return { ...rest, ...details, companions, shared, mode: "group" } as MoneyGroup;
  }
  const merged = { ...local, ...(details ?? {}), companions, shared } as Shareable;
  return merged.kind !== "planned" && merged.kind !== "group" ? { ...merged, mode: "group" } : merged;
}

