import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useAiContextStore } from "../store/aiContextStore";
import { chooseChatContext } from "../services/chatContext";
import { TEMP_CHAT_KEY, useChatStore } from "../store/chatStore";

/** The trip, group, overview or general context the AI tab is on (see `chooseChatContext`). */
export function useChatContext(): string {
  const picked = useAiContextStore((state) => state.picked);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const trips = useTripsStore((state) => state.trips);
  const groups = useTripsStore((state) => state.groups);
  const expenses = useExpensesStore((state) => state.expenses);
  const settlements = useExpensesStore((state) => state.settlements);
  return chooseChatContext({ picked, activeTripId, trips, groups, expenses, settlements });
}

/** Conversation the AI tab shows: the temporary chat when it's on, else the context's own chat. */
export function useChatConversationKey(): string {
  const context = useChatContext();
  const temporary = useChatStore((state) => state.temporary);
  return temporary ? TEMP_CHAT_KEY : context;
}
