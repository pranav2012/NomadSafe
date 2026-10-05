import { AppState } from "react-native";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { aiRuntime, aiService, modelNotifications, type ChatTurn } from "@/modules/ai";
import { loadTripMoneySnapshot } from "../services/chatContext";
import { logger } from "@/modules/logger";

export interface ChatMessage {
  from: "ai" | "you";
  text: string;
  generating?: boolean;
  error?: boolean;
  /** Epoch ms; absent on messages saved before timestamps were added. */
  createdAt?: number;
}

export interface ChatErrorLabels {
  noModel: string;
  error: string;
}

export const GENERAL_CHAT_KEY = "general";
/** In-memory only conversation for temporary chats; never persisted. */
export const TEMP_CHAT_KEY = "temp";

type PromptTurn = Pick<ChatTurn, "role" | "content">;

export interface ChatConversation {
  messages: ChatMessage[];
  summary: string | null;
  contextMessages: PromptTurn[];
}

interface ChatState {
  conversations: Record<string, ChatConversation>;
  generatingConversationKey: string | null;
  /** Temporary chat mode: replies go to TEMP_CHAT_KEY, which is never saved. */
  temporary: boolean;
  setTemporary: (on: boolean) => void;
  /** Returns false when the message was not accepted (e.g. another reply is generating). */
  send: (conversationKey: string, text: string, labels: ChatErrorLabels) => boolean;
  /** Stops the reply being generated, keeping any partial text. */
  stop: () => void;
  clear: (conversationKey: string) => void;
  removeConversation: (conversationKey: string) => void;
  reset: () => void;
}

interface ChatStreamState {
  conversationKey: string | null;
  text: string;
}

/**
 * Live streaming text, kept out of the persisted store so tokens don't trigger
 * an MMKV write per token. The final reply is persisted once on completion.
 */
export const useChatStreamStore = create<ChatStreamState>()(() => ({
  conversationKey: null,
  text: "",
}));

const STREAM_UPDATE_INTERVAL_MS = 50;

let stopRequested = false;
// Bumped when a conversation is cleared so an in-flight reply doesn't write into the emptied chat.
const conversationEpochs: Record<string, number> = {};
const epochOf = (conversationKey: string) => conversationEpochs[conversationKey] ?? 0;
const bumpEpoch = (conversationKey: string) => {
  conversationEpochs[conversationKey] = epochOf(conversationKey) + 1;
};

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
      const stopIfGenerating = (conversationKey: string) => {
        if (get().generatingConversationKey !== conversationKey) return;
        stopRequested = true;
        void aiService.stopChat();
      };

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
        temporary: false,

        setTemporary: (on) => {
          if (on === get().temporary) return;
          get().clear(TEMP_CHAT_KEY);
          set({ temporary: on });
        },

        send: (conversationKey, text, labels) => {
          if (get().generatingConversationKey) return false;
          const question = text.trim();
          if (!question) return false;
          stopRequested = false;
          const now = Date.now();
          const epoch = epochOf(conversationKey);
          const stale = () => epochOf(conversationKey) !== epoch;

          set((state) => {
            const conversation = state.conversations[conversationKey] ?? emptyConversation();
            return {
              conversations: {
                ...state.conversations,
                [conversationKey]: {
                  ...conversation,
                  messages: [
                    ...conversation.messages,
                    { from: "you", text: question, createdAt: now },
                    { from: "ai", text: "", generating: true, createdAt: now },
                  ],
                },
              },
              generatingConversationKey: conversationKey,
            };
          });

          const conversation = get().conversations[conversationKey] ?? emptyConversation();
          const history: ChatTurn[] = [
            ...conversation.contextMessages,
            { role: "user", content: question },
          ];
          let streamed = "";
          let lastFlush = 0;
          let flushTimer: ReturnType<typeof setTimeout> | null = null;
          const flushStream = () => {
            flushTimer = null;
            lastFlush = Date.now();
            useChatStreamStore.setState({ conversationKey, text: streamed });
          };
          const clearStream = () => {
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = null;
            useChatStreamStore.setState({ conversationKey: null, text: "" });
          };

          // Every question goes to the model, with the trip's computed money facts in its prompt.
          // Gmail merchants are always hidden: saved chat history and summaries can later go online.
          loadTripMoneySnapshot(new Date(), { hideEmailMerchants: true })
            .catch((error: unknown) => {
              logger.warn("chatStore", "money facts unavailable", error);
              return null;
            })
            .then(async (snapshot) => {
              const systemContext = snapshot?.context;
              const memory = await aiService.prepareChatMemory(history, {
                systemContext,
                conversationSummary: conversation.summary ?? undefined,
              });
              if (stale()) return "";
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
              if (stopRequested) return "";
              const reply = await aiService.chat(memory.history, {
                systemContext,
                conversationSummary: memory.summary ?? undefined,
                contextTokens: memory.contextTokens,
                onToken: (_delta, accumulated) => {
                  streamed = accumulated;
                  if (flushTimer) return;
                  const wait = Math.max(0, STREAM_UPDATE_INTERVAL_MS - (Date.now() - lastFlush));
                  flushTimer = setTimeout(flushStream, wait);
                },
              });
              return reply;
            })
            .then((reply) => {
              clearStream();
              if (stale()) return;
              const text = reply.trim();
              set((state) => {
                const current = state.conversations[conversationKey] ?? emptyConversation();
                const messages = [...current.messages];
                const last = messages[messages.length - 1];
                if (last?.from === "ai") {
                  if (text) {
                    messages[messages.length - 1] = { ...last, text, generating: false };
                  } else {
                    messages.pop();
                  }
                }
                return {
                  conversations: {
                    ...state.conversations,
                    [conversationKey]: {
                      ...current,
                      messages,
                      contextMessages: text
                        ? [...current.contextMessages, { role: "assistant", content: text }]
                        : current.contextMessages,
                    },
                  },
                };
              });
            })
            .catch((error: unknown) => {
              clearStream();
              logger.warn("chatStore", "reply generation failed", error);
              if (stale()) return;
              const noModel = error instanceof Error && error.message.includes("not downloaded");
              updateLast(conversationKey, (message) => ({
                ...message,
                text: noModel ? labels.noModel : labels.error,
                generating: false,
                error: true,
              }));
            })
            .finally(() => {
              stopRequested = false;
              set({ generatingConversationKey: null });
              if (AppState.currentState !== "active") {
                modelNotifications.notifyAssistantReply();
                aiRuntime.release();
              }
            });
          return true;
        },

        stop: () => {
          if (!get().generatingConversationKey) return;
          stopRequested = true;
          void aiService.stopChat();
        },

        clear: (conversationKey) => {
          stopIfGenerating(conversationKey);
          bumpEpoch(conversationKey);
          set((state) => ({
            conversations: {
              ...state.conversations,
              [conversationKey]: emptyConversation(),
            },
          }));
        },

        removeConversation: (conversationKey) => {
          stopIfGenerating(conversationKey);
          bumpEpoch(conversationKey);
          set((state) => {
            const { [conversationKey]: _removed, ...conversations } = state.conversations;
            return { conversations };
          });
        },
        reset: () => {
          for (const key of Object.keys(get().conversations)) bumpEpoch(key);
          set({ conversations: {}, generatingConversationKey: null, temporary: false });
        },
      };
    },
    {
      name: "ai-chat-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: (state) => {
        const { [TEMP_CHAT_KEY]: _temporary, ...conversations } = state.conversations;
        return { conversations };
      },
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

        delete conversations[TEMP_CHAT_KEY];
        return { ...current, conversations, generatingConversationKey: null };
      },
    },
  ),
);
