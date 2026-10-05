import { useTripsStore } from "@/features/trips/store/tripsStore";
import { GENERAL_CHAT_KEY, TEMP_CHAT_KEY, useChatStore } from "../store/chatStore";

/** Conversation the AI tab shows: the temporary chat when it's on, else the active trip's (or the general) chat. */
export function useChatConversationKey(): string {
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const temporary = useChatStore((state) => state.temporary);
  if (temporary) return TEMP_CHAT_KEY;
  return activeTripId ?? GENERAL_CHAT_KEY;
}
