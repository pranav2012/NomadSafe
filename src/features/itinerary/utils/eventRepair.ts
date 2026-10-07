/**
 * Puts back a `tripId` that an older sync renamed to `groupId` (it ran the expenses' legacy rename on
 * itinerary events too, leaving them in no trip). Events never carry `groupId` otherwise.
 */
export function repairEventTripId<T extends { tripId?: string | null }>(event: T): T {
  const broken = event as T & { groupId?: string | null };
  if (broken.tripId !== undefined || !("groupId" in broken)) return event;
  const { groupId, ...rest } = broken;
  return { ...rest, tripId: groupId ?? null } as T;
}
