import { AppState } from "react-native";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import { localModelService, type ChatTurn } from "../services/localModelService";
import { modelNotifications } from "../services/modelNotifications";
import { buildTripMoneyContext } from "../services/chatContext";

export interface ChatMessage {
  from: "ai" | "you";
  text: string;
  generating?: boolean;
  /** Error/system bubbles are shown but not fed back to the model as context. */
  error?: boolean;
}

/** Localized strings the store needs for error bubbles (passed in by the UI). */
export interface ChatErrorLabels {
  noModel: string;
  error: string;
}

interface ChatState {
  messages: ChatMessage[];
  isGenerating: boolean;
  send: (text: string, labels: ChatErrorLabels) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      const updateLast = (updater: (msg: ChatMessage) => ChatMessage) =>
        set((state) => {
          const messages = [...state.messages];
          messages[messages.length - 1] = updater(messages[messages.length - 1]);
          return { messages };
        });

      return {
        messages: [],
        isGenerating: false,

        send: (text, labels) => {
          if (get().isGenerating) return;
          const q = text.trim();
          if (!q) return;

          const history: ChatTurn[] = [...get().messages, { from: "you" as const, text: q }]
            .filter((m) => m.text.trim().length > 0 && !("error" in m && m.error))
            .map((m) => ({ role: m.from === "you" ? "user" : "assistant", content: m.text }));

          set((state) => ({
            messages: [
              ...state.messages,
              { from: "you", text: q },
              { from: "ai", text: "", generating: true },
            ],
            isGenerating: true,
          }));

          localModelService
            .chat(history, {
              systemContext: buildTripMoneyContext() ?? undefined,
              onToken: (_delta, accumulated) => {
                updateLast((msg) => ({ ...msg, text: accumulated, generating: false }));
              },
            })
            .then((full) => {
              updateLast((msg) => ({ ...msg, text: full, generating: false }));
            })
            .catch((err: unknown) => {
              console.warn("[chatStore] reply generation failed", err);
              const noModel = err instanceof Error && err.message.includes("not downloaded");
              updateLast((msg) => ({
                ...msg,
                text: noModel ? labels.noModel : labels.error,
                generating: false,
                error: true,
              }));
            })
            .finally(() => {
              set({ isGenerating: false });
              // If the user left the app while we were generating, let them know
              // the reply landed and free the model RAM that we kept alive for it.
              if (AppState.currentState !== "active") {
                modelNotifications.notifyAssistantReply();
                localModelService.release();
              }
            });
        },

        clear: () => set({ messages: [] }),
      };
    },
    {
      name: "ai-chat-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: (state) => ({ messages: state.messages }),
      // Drop any half-finished bubble from a previous run and never restore a
      // stuck "generating" flag.
      merge: (persisted, current) => {
        const saved = (persisted as Partial<ChatState> | undefined)?.messages ?? [];
        const messages = saved
          .map((m) => ({ ...m, generating: false }))
          .filter((m) => m.text.trim().length > 0);
        return { ...current, messages, isGenerating: false };
      },
    },
  ),
);
