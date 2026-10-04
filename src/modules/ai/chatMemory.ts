import type { ChatMemory, ChatTurn } from "./prompts";

const COMPACTION_THRESHOLD = 0.6;
const COMPACTED_HISTORY_TARGET = 0.15;
const RECENT_HISTORY_TARGET = 0.05;
const SUMMARY_TARGET = COMPACTED_HISTORY_TARGET - RECENT_HISTORY_TARGET;
const SUMMARY_MAX_TOKENS = 512;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimToTokenBudget(text: string, tokenBudget: number): string {
  return text.slice(0, Math.max(0, tokenBudget) * 4).trim();
}

function tailToTokenBudget(text: string, tokenBudget: number): string {
  return text.slice(-Math.max(0, tokenBudget) * 4).trim();
}

export function formatHistory(history: ChatTurn[]): string {
  return history.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`).join("\n");
}

/**
 * Keeps a chat within `contextTokens` (and `maxTurns`): once the prompt passes 60% of it, older
 * turns are folded into a summary (written by `summarize`) and only the most recent turns are kept verbatim.
 */
export async function compactChatMemory(
  history: ChatTurn[],
  systemPrompt: string,
  existingSummary: string,
  contextTokens: number,
  summarize: (source: string, maxTokens: number) => Promise<string>,
  maxTurns = Infinity,
): Promise<ChatMemory> {
  const promptTokens = estimateTokens(systemPrompt) + estimateTokens(formatHistory(history));
  if (promptTokens < contextTokens * COMPACTION_THRESHOLD && history.length <= maxTurns) {
    return { summary: existingSummary || null, history, contextTokens };
  }

  const recentBudget = Math.floor(contextTokens * RECENT_HISTORY_TARGET);
  const recentHistory: ChatTurn[] = [];
  let recentTokens = 0;
  for (const turn of [...history].reverse()) {
    const turnTokens = estimateTokens(`${turn.role}: ${turn.content}`);
    if (recentHistory.length > 0 && (recentTokens + turnTokens > recentBudget || recentHistory.length >= maxTurns / 2)) break;
    recentHistory.unshift(turn);
    recentTokens += turnTokens;
  }

  const olderHistory = history.slice(0, history.length - recentHistory.length);
  if (olderHistory.length === 0) {
    return { summary: existingSummary || null, history: recentHistory, contextTokens };
  }

  const summaryTarget = Math.floor(contextTokens * SUMMARY_TARGET);
  const sourceBudget = Math.floor(contextTokens * 0.3);
  const summarySource = trimToTokenBudget(existingSummary, Math.floor(sourceBudget / 2));
  const historySource = tailToTokenBudget(formatHistory(olderHistory), sourceBudget - estimateTokens(summarySource));
  const source = [summarySource, historySource].filter(Boolean).join("\n\n");
  const text = await summarize(source, Math.min(SUMMARY_MAX_TOKENS, summaryTarget));

  return {
    summary: trimToTokenBudget(text, summaryTarget) || null,
    history: recentHistory,
    contextTokens,
  };
}
