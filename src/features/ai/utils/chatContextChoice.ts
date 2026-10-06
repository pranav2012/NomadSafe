import { isArchivedGroup, type Group, type Trip } from "@/features/trips/store/tripsStore";

export const GENERAL_CONTEXT = "general";
export const OVERVIEW_CONTEXT = "overview";

/** The latest activity in a group: an expense or payment by anyone, else when it was created or joined. */
function lastActivity(group: Group, expenses: { groupId: string | null; date: string }[], settlements: { groupId: string; date: string }[]) {
  const dates = [group.createdAt, ...expenses.filter((item) => item.groupId === group.id).map((item) => item.date), ...settlements.filter((item) => item.groupId === group.id).map((item) => item.date)];
  return Math.max(...dates.map((date) => new Date(date).getTime() || 0));
}

export interface ChatContextInput {
  picked: string | null;
  activeTripId: string | null;
  trips: Trip[];
  groups: Group[];
  expenses: { groupId: string | null; date: string }[];
  settlements: { groupId: string; date: string }[];
}

/**
 * What the AI tab talks about: the user's pick while it still exists, else the active trip, else the
 * group with the latest activity, else the general chat.
 */
export function chooseChatContext({ picked, activeTripId, trips, groups, expenses, settlements }: ChatContextInput): string {
  if (picked === GENERAL_CONTEXT || picked === OVERVIEW_CONTEXT) return picked;
  if (picked && (trips.some((trip) => trip.id === picked) || groups.some((group) => group.id === picked))) return picked;
  if (activeTripId) return activeTripId;
  const latest = groups
    .filter((group) => !isArchivedGroup(group))
    .map((group) => ({ id: group.id, at: lastActivity(group, expenses, settlements) }))
    .sort((a, b) => b.at - a.at)[0];
  return latest?.id ?? GENERAL_CONTEXT;
}
