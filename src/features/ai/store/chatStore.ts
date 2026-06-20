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
  error?: boolean;
}

export interface ChatErrorLabels {
  noModel: string;
  error: string;
}

export const GENERAL_CHAT_KEY = "general";

type PromptTurn = Pick<ChatTurn, "role" | "content">;

export interface ChatConversation {
  messages: ChatMessage[];
  summary: string | null;
  contextMessages: PromptTurn[];
}

interface ChatState {
  conversations: Record<string, ChatConversation>;
  generatingConversationKey: string | null;
  send: (conversationKey: string, text: string, labels: ChatErrorLabels) => void;
  clear: (conversationKey: string) => void;
  removeConversation: (conversationKey: string) => void;
  reset: () => void;
}

function emptyConversation(): ChatConversation {
  return { messages: [], summary: null, contextMessages: [] };
}

function historyFromMessages(messages: ChatMessage[]): PromptTurn[] {
  return messages
    .filter((message) => !message.error)
    .map((message) => ({
      role: message.from === "you" ? "user" as const : "assistant" as const,
      content: message.text,
    }));
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      const updateLast = (conversationKey: string, updater: (message: ChatMessage) => ChatMessage) =>
        set((state) => {
          const conversation = state.conversations[conversationKey] ?? emptyConversation();
          const messages = [...conversation.messages];
          messages[messages.length - 1] = updater(messages[messages.length - 1]);
          return {
            conversations: {
              ...state.conversations,
              [conversationKey]: { ...conversation, messages },
            },
          };
        });

      return {
        conversations: {},
        generatingConversationKey: null,

        send: (conversationKey, text, labels) => {
          if (get().generatingConversationKey) return;
          const question = text.trim();
          if (!question) return;

          set((state) => {
            const conversation = state.conversations[conversationKey] ?? emptyConversation();
            return {
              conversations: {
                ...state.conversations,
                [conversationKey]: {
                  ...conversation,
                  messages: [
                    ...conversation.messages,
                    { from: "you", text: question },
                    { from: "ai", text: "", generating: true },
                  ],
                },
              },
              generatingConversationKey: conversationKey,
            };
          });

          const conversation = get().conversations[conversationKey] ?? emptyConversation();
          const systemContext = buildTripMoneyContext() ?? undefined;
          const history: ChatTurn[] = [
            ...conversation.contextMessages,
            { role: "user", content: question },
          ];

          localModelService
            .prepareChatMemory(history, {
              systemContext,
              conversationSummary: conversation.summary ?? undefined,
            })
            .then((memory) => {
              set((state) => {
                const current = state.conversations[conversationKey] ?? emptyConversation();
                return {
                  conversations: {
                    ...state.conversations,
                    [conversationKey]: {
                      ...current,
                      summary: memory.summary,
                      contextMessages: memory.history,
                    },
                  },
                };
              });
              return localModelService.chat(memory.history, {
                systemContext,
                conversationSummary: memory.summary ?? undefined,
                contextTokens: memory.contextTokens,
                onToken: (_delta, accumulated) => {
                  updateLast(conversationKey, (message) => ({
                    ...message,
                    text: accumulated,
                    generating: false,
                  }));
                },
              });
            })
            .then((reply) => {
              updateLast(conversationKey, (message) => ({ ...message, text: reply, generating: false }));
              set((state) => {
                const current = state.conversations[conversationKey] ?? emptyConversation();
                return {
                  conversations: {
                    ...state.conversations,
                    [conversationKey]: {
                      ...current,
                      contextMessages: [
                        ...current.contextMessages,
                        { role: "assistant", content: reply },
                      ],
                    },
                  },
                };
              });
            })
            .catch((error: unknown) => {
              console.warn("[chatStore] reply generation failed", error);
              const noModel = error instanceof Error && error.message.includes("not downloaded");
              updateLast(conversationKey, (message) => ({
                ...message,
                text: noModel ? labels.noModel : labels.error,
                generating: false,
                error: true,
              }));
            })
            .finally(() => {
              set({ generatingConversationKey: null });
              if (AppState.currentState !== "active") {
                modelNotifications.notifyAssistantReply();
                localModelService.release();
              }
            });
        },

        clear: (conversationKey) =>
          set((state) => ({
            conversations: {
              ...state.conversations,
              [conversationKey]: emptyConversation(),
            },
          })),

        removeConversation: (conversationKey) =>
          set((state) => {
            const { [conversationKey]: _removed, ...conversations } = state.conversations;
            return { conversations };
          }),
        reset: () => set({ conversations: {}, generatingConversationKey: null }),
      };
    },
    {
      name: "ai-chat-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: (state) => ({ conversations: state.conversations }),
      merge: (persisted, current) => {
        const stored = persisted as (Partial<ChatState> & Partial<ChatConversation>) | undefined;
        const conversations = Object.fromEntries(
          Object.entries(stored?.conversations ?? {}).map(([key, conversation]) => [
            key,
            {
              ...conversation,
              messages: conversation.messages
                .map((message) => ({ ...message, generating: false }))
                .filter((message) => message.text.trim().length > 0),
            },
          ]),
        ) as Record<string, ChatConversation>;
        const legacyMessages = stored?.messages ?? [];

        if (legacyMessages.length > 0 && !conversations[GENERAL_CHAT_KEY]) {
          const messages = legacyMessages
            .map((message) => ({ ...message, generating: false }))
            .filter((message) => message.text.trim().length > 0);
          conversations[GENERAL_CHAT_KEY] = {
            messages,
            summary: stored?.summary ?? null,
            contextMessages: stored?.contextMessages ?? historyFromMessages(messages),
          };
        }

        return { ...current, conversations, generatingConversationKey: null };
      },
    },
  ),
);
