import { useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { AiTask, RemoteProvider } from "./policy";
import { appendUsage, summarizeUsage, type AiUsageEntry, type AiUsageSummary } from "./usageLogRules";

interface AiUsageLogState {
  entries: AiUsageEntry[];
}

const useAiUsageLogStore = create<AiUsageLogState>()(
  persist(() => ({ entries: [] as AiUsageEntry[] }), {
    name: "ai-usage-log",
    storage: createJSONStorage(() => mmkvStateStorage),
    version: 1,
  }),
);

/** Notes one successful online AI use on this phone. */
export function recordAiUsage(task: AiTask, provider: RemoteProvider) {
  useAiUsageLogStore.setState((state) => ({ entries: appendUsage(state.entries, { task, provider, at: Date.now() }) }));
}

/** On sign-out and wipe, like the AI preference. */
export function clearAiUsageLog() {
  useAiUsageLogStore.setState({ entries: [] });
}

/** This month's online AI uses on this phone: recent entries and per-feature counts per provider. */
export function useAiUsageLog(): AiUsageSummary {
  const entries = useAiUsageLogStore((s) => s.entries);
  const [now] = useState(Date.now);
  return summarizeUsage(entries, now);
}
