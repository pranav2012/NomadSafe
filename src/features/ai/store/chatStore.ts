import { AppState } from "react-native";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import { localModelService, type ChatTurn } from "../services/localModelService";
import { modelNotifications } from "../services/modelNotifications";
import { loadTripMoneySnapshot } from "../services/chatContext";
import {
  answerMoneyIntent,
  matchMoneyIntent,
  parseAmount,
  type MoneyIntent,
  type MoneyIntentMatch,
} from "../services/moneyFacts";
import { translate } from "@/localization/translate";

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

export interface SendOptions {
  /** Forces a deterministic money answer (quick question chips). */
  intent?: MoneyIntent;
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
  /** Returns false when the message was not accepted (e.g. another reply is generating). */
  send: (conversationKey: string, text: string, labels: ChatErrorLabels, options?: SendOptions) => boolean;
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

        send: (conversationKey, text, labels, options) => {
          if (get().generatingConversationKey) return false;
          const question = text.trim();
          if (!question) return false;
          stopRequested = false;
          const now = Date.now();

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
          const moneyMatch: MoneyIntentMatch | null = options?.intent
            ? { intent: options.intent, amount: parseAmount(question) }
            : matchMoneyIntent(question, translate("aiTab.quickAffordPrefix"));

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

          // Money intents are answered from computed facts without the model;
          // everything else goes to the model with those facts in the prompt.
          loadTripMoneySnapshot()
            .catch((error: unknown) => {
              console.warn("[chatStore] money facts unavailable", error);
              return null;
            })
            .then(async (snapshot) => {
              if (moneyMatch) {
                const reply = answerMoneyIntent(moneyMatch, snapshot?.facts ?? null, translate, snapshot?.locale ?? "en");
                return { reply, deterministic: true };
              }
              const systemContext = snapshot?.context;
              const memory = await localModelService.prepareChatMemory(history, {
                systemContext,
                conversationSummary: conversation.summary ?? undefined,
              });
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
              if (stopRequested) return { reply: "", deterministic: false };
              const reply = await localModelService.chat(memory.history, {
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
              return { reply, deterministic: false };
            })
            .then(({ reply, deterministic }) => {
              clearStream();
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
                      contextMessages: !text
                        ? current.contextMessages
                        : deterministic
                          ? [
                              ...current.contextMessages,
                              { role: "user", content: question },
                              { role: "assistant", content: text },
                            ]
                          : [...current.contextMessages, { role: "assistant", content: text }],
                    },
                  },
                };
              });
            })
            .catch((error: unknown) => {
              clearStream();
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
              stopRequested = false;
              set({ generatingConversationKey: null });
              if (AppState.currentState !== "active") {
                modelNotifications.notifyAssistantReply();
                localModelService.release();
              }
            });
          return true;
        },

        stop: () => {
          if (!get().generatingConversationKey) return;
          stopRequested = true;
          localModelService.stopChat();
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
