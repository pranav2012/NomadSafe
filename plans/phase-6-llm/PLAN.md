# Phase 6: On-device LLM (Premium Feature)

## Overview

This phase adds an on-device AI assistant powered by llama.cpp (via react-native-llama). Users can download quantized GGUF models, chat with an AI about their expenses, get spending pattern insights, and receive budget suggestions — all entirely on-device with no cloud inference. This is designed as a premium feature that can be gated behind a paywall in the future.

## Dependencies

- Phase 1 (design system, auth, Convex, storage)
- Phase 3 (expense data — the AI analyzes spending patterns)

---

## Step 1: Install Packages

```bash
pnpm add react-native-llama
```

`expo-file-system` already installed in Phase 3 (used for model file management).

> Note: `react-native-llama` may require native module setup. Check the package docs for any Expo config plugin requirements. May need `npx expo prebuild` after install.

---

## Step 2: TypeScript Types

### types/ai.ts

```typescript
export type ModelSize = "small" | "medium" | "large";
export type ModelStatus = "not_downloaded" | "downloading" | "downloaded" | "loading" | "ready";

export interface LLMModel {
  id: string;
  name: string;                    // e.g., "TinyLlama 1.1B"
  fileName: string;                // e.g., "tinyllama-1.1b-q4_k_m.gguf"
  downloadUrl: string;
  sizeBytes: number;
  sizeLabel: string;               // e.g., "700 MB"
  quantization: string;            // e.g., "Q4_K_M"
  modelSize: ModelSize;
  minRamMB: number;
  description: string;
  status: ModelStatus;
  downloadProgress: number;        // 0-1
  localPath: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokenCount?: number;
  generationTimeMs?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  modelId: string;
  tripId: string | null;           // optional trip context
  createdAt: number;
  updatedAt: number;
}

export type InsightType =
  | "spending_pattern"
  | "budget_suggestion"
  | "category_anomaly"
  | "saving_tip"
  | "comparison";

export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  tripId: string | null;
  generatedAt: number;
}

export interface PremiumStatus {
  isActive: boolean;
  activatedAt: number | null;
}
```

---

## Step 3: Model Registry

### constants/models.ts

```typescript
import type { LLMModel } from '@/types/ai';

export const MODEL_REGISTRY: Omit<LLMModel, 'status' | 'downloadProgress' | 'localPath'>[] = [
  {
    id: "tinyllama-1.1b",
    name: "TinyLlama 1.1B",
    fileName: "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
    sizeBytes: 669_000_000,
    sizeLabel: "~670 MB",
    quantization: "Q4_K_M",
    modelSize: "small",
    minRamMB: 2048,
    description: "Fast responses, good for quick queries. Lower quality but works on all devices.",
  },
  {
    id: "phi-2-2.7b",
    name: "Phi-2 2.7B",
    fileName: "phi-2.Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf",
    sizeBytes: 1_700_000_000,
    sizeLabel: "~1.7 GB",
    quantization: "Q4_K_M",
    modelSize: "medium",
    minRamMB: 3072,
    description: "Good balance of speed and quality. Recommended for most devices.",
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    fileName: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    sizeBytes: 2_020_000_000,
    sizeLabel: "~2 GB",
    quantization: "Q4_K_M",
    modelSize: "large",
    minRamMB: 4096,
    description: "Best quality responses. Requires newer devices with 4GB+ RAM.",
  },
];
```

> Note: Model URLs may change. Verify availability before implementation. Consider hosting GGUF files on your own CDN for reliability.

---

## Step 4: LLM Service

### services/llmService.ts

```typescript
import { initLlama, type LlamaContext } from 'react-native-llama';

let context: LlamaContext | null = null;
let currentModelPath: string | null = null;

export const llmService = {
  /**
   * Load a GGUF model into memory.
   * Only one model can be loaded at a time.
   */
  async loadModel(modelPath: string): Promise<void> {
    // Unload existing model first
    if (context) await this.unloadModel();

    context = await initLlama({
      model: modelPath,
      n_ctx: 2048,           // context window size
      n_threads: 4,          // CPU threads for inference
      n_gpu_layers: 0,       // GPU offload (0 for max compatibility)
      use_mlock: true,       // lock model in RAM
    });

    currentModelPath = modelPath;
  },

  /**
   * Generate a response from the loaded model.
   * Supports streaming via onToken callback.
   */
  async generateResponse(
    prompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      topP?: number;
      onToken?: (token: string) => void;
      signal?: AbortSignal;
    }
  ): Promise<{ text: string; tokenCount: number; timeMs: number }> {
    if (!context) throw new Error("No model loaded");

    const startTime = Date.now();

    const result = await context.completion(
      {
        prompt,
        n_predict: options?.maxTokens ?? 512,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.9,
        stop: ["</s>", "\n\nUser:", "\n\nHuman:", "<|end|>"],
      },
      options?.onToken
    );

    return {
      text: result.text.trim(),
      tokenCount: result.tokens_predicted ?? 0,
      timeMs: Date.now() - startTime,
    };
  },

  /**
   * Unload model from memory.
   */
  async unloadModel(): Promise<void> {
    if (context) {
      await context.release();
      context = null;
      currentModelPath = null;
    }
  },

  /**
   * Check if a model is currently loaded.
   */
  isLoaded(): boolean {
    return context !== null;
  },

  /**
   * Get path of currently loaded model.
   */
  getCurrentModelPath(): string | null {
    return currentModelPath;
  },
};
```

---

## Step 5: Model Manager

### services/modelManager.ts

```typescript
import * as FileSystem from 'expo-file-system';
import type { LLMModel } from '@/types/ai';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;

export const modelManager = {
  /**
   * Ensure models directory exists.
   */
  async init(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    }
  },

  /**
   * Get local path for a model.
   */
  getModelPath(fileName: string): string {
    return `${MODELS_DIR}${fileName}`;
  },

  /**
   * Check if a model is downloaded.
   */
  async isDownloaded(fileName: string): Promise<boolean> {
    const path = this.getModelPath(fileName);
    const info = await FileSystem.getInfoAsync(path);
    return info.exists;
  },

  /**
   * Download a model with progress tracking.
   * Returns a resumable download object.
   */
  downloadModel(
    url: string,
    fileName: string,
    onProgress: (progress: number) => void
  ): FileSystem.DownloadResumable {
    const path = this.getModelPath(fileName);

    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      path,
      {},
      (downloadProgress) => {
        const progress =
          downloadProgress.totalBytesWritten /
          downloadProgress.totalBytesExpectedToWrite;
        onProgress(progress);
      }
    );

    return downloadResumable;
  },

  /**
   * Delete a downloaded model.
   */
  async deleteModel(fileName: string): Promise<void> {
    const path = this.getModelPath(fileName);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path);
    }
  },

  /**
   * Get total size of all downloaded models.
   */
  async getTotalModelSize(): Promise<number> {
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(MODELS_DIR);
    let totalSize = 0;

    for (const file of files) {
      const info = await FileSystem.getInfoAsync(`${MODELS_DIR}${file}`);
      if (info.exists && 'size' in info) {
        totalSize += info.size ?? 0;
      }
    }

    return totalSize;
  },
};
```

---

## Step 6: Insight Engine

### services/insightEngine.ts

```typescript
import type { Expense } from '@/types/expense';
import type { Trip, TripMember } from '@/types/trip';

/**
 * Build a system prompt for the expense AI assistant.
 */
export function buildSystemPrompt(): string {
  return `You are a helpful travel budget advisor built into NomadSafe, a travel companion app. You analyze travel expenses and provide concise, actionable insights. Keep responses short (2-4 sentences per point). Use currency formatting. Be friendly but direct.`;
}

/**
 * Build a prompt for generating spending insights.
 */
export function buildInsightPrompt(
  expenses: Expense[],
  trip: Trip,
  members: TripMember[]
): string {
  const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);
  const categoryTotals: Record<string, number> = {};
  for (const e of expenses) {
    categoryTotals[e.category] = (categoryTotals[e.category] ?? 0) + e.amount;
  }

  const categoryBreakdown = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amount]) => `  ${cat}: ${trip.currency} ${amount.toFixed(2)}`)
    .join("\n");

  const days = expenses.length > 0
    ? new Set(expenses.map((e) => e.date)).size
    : 1;

  return `Analyze these travel expenses for a ${trip.isGroup ? "group" : "solo"} trip to ${trip.destination}:

Total spent: ${trip.currency} ${totalSpent.toFixed(2)} over ${days} days
Daily average: ${trip.currency} ${(totalSpent / days).toFixed(2)}
${trip.isGroup ? `Members: ${members.length}` : ""}

Category breakdown:
${categoryBreakdown}

Recent expenses:
${expenses.slice(0, 15).map((e) => `- ${e.date}: ${e.category} ${trip.currency}${e.amount.toFixed(2)} "${e.title}"`).join("\n")}

Provide 3-4 concise insights about:
1. Spending patterns (what categories dominate)
2. Daily spending trend
3. Budget suggestions
4. Any unusual expenses`;
}

/**
 * Build a prompt for natural language expense queries.
 */
export function buildQueryPrompt(
  query: string,
  expenses: Expense[],
  trip: Trip | null,
  members: TripMember[]
): string {
  const context = expenses.slice(0, 30).map((e) => {
    const payer = members.find((m) => m._id === e.paidByMemberId)?.name ?? "Unknown";
    return `${e.date} | ${e.category} | ${e.currency}${e.amount.toFixed(2)} | "${e.title}" | paid by ${payer}`;
  }).join("\n");

  return `Based on these expense records:
${context}

${trip ? `Trip: ${trip.title} to ${trip.destination} (${trip.currency})` : "All trips"}

User question: ${query}

Answer concisely using the data above.`;
}

/**
 * Parse LLM response into structured insights.
 */
export function parseInsights(response: string, tripId: string | null): Insight[] {
  // Split response by numbered points or paragraphs
  // Create Insight objects with appropriate types
  // Return array of insights
  const lines = response.split("\n").filter((l) => l.trim().length > 0);
  const insights: Insight[] = [];

  for (const line of lines) {
    const cleanLine = line.replace(/^\d+[\.\)]\s*/, "").trim();
    if (cleanLine.length < 10) continue;

    insights.push({
      id: generateId(),
      type: classifyInsight(cleanLine),
      title: cleanLine.split(".")[0] || cleanLine.substring(0, 50),
      description: cleanLine,
      tripId,
      generatedAt: Date.now(),
    });
  }

  return insights;
}

function classifyInsight(text: string): InsightType {
  const lower = text.toLowerCase();
  if (lower.includes("budget") || lower.includes("limit")) return "budget_suggestion";
  if (lower.includes("save") || lower.includes("reduce")) return "saving_tip";
  if (lower.includes("unusual") || lower.includes("high") || lower.includes("spike")) return "category_anomaly";
  if (lower.includes("compar") || lower.includes("average")) return "comparison";
  return "spending_pattern";
}
```

---

## Step 7: Zustand Store

### stores/aiStore.ts

```typescript
interface AIState {
  // Models
  models: Record<string, LLMModel>;
  activeModelId: string | null;

  // Chat
  chatSessions: Record<string, ChatSession>;
  activeChatSessionId: string | null;

  // Insights
  insights: Insight[];

  // Premium
  premium: PremiumStatus;

  // Inference state
  isInferring: boolean;
  inferenceProgress: string;       // streaming text buffer

  // Model actions
  initModels: () => void;          // populate from MODEL_REGISTRY
  setModelStatus: (modelId: string, status: ModelStatus) => void;
  setModelDownloadProgress: (modelId: string, progress: number) => void;
  setModelLocalPath: (modelId: string, path: string) => void;
  setActiveModel: (modelId: string | null) => void;
  removeModel: (modelId: string) => void;

  // Chat actions
  createChatSession: (modelId: string, tripId?: string) => string;
  addMessage: (sessionId: string, message: Omit<ChatMessage, "id" | "timestamp">) => void;
  deleteChatSession: (sessionId: string) => void;
  setActiveChatSession: (sessionId: string | null) => void;
  setInferring: (value: boolean) => void;
  setInferenceProgress: (text: string) => void;
  appendInferenceProgress: (token: string) => void;

  // Insight actions
  setInsights: (insights: Insight[]) => void;
  addInsight: (insight: Insight) => void;
  clearInsights: () => void;

  // Premium actions
  setPremiumStatus: (status: PremiumStatus) => void;
}

// Selectors
export const selectActiveModel = (state: AIState) =>
  state.activeModelId ? state.models[state.activeModelId] ?? null : null;

export const selectDownloadedModels = (state: AIState) =>
  Object.values(state.models).filter((m) => m.status === "downloaded" || m.status === "ready");

export const selectActiveChatSession = (state: AIState) =>
  state.activeChatSessionId ? state.chatSessions[state.activeChatSessionId] ?? null : null;
```

Persisted via MMKV. Chat sessions pruned to last 50 messages each.

---

## Step 8: Convex (Premium Status Sync)

### convex/schema.ts (MODIFY)

```typescript
premiumStatus: defineTable({
  userId: v.id("users"),
  isActive: v.boolean(),
  activatedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"]),
```

### convex/premium.ts

```typescript
// getPremiumStatus — check if user has premium
// setPremiumStatus — toggle premium (for dev/testing)
// In future: webhook from IAP provider updates this
```

---

## Step 9: File Structure

```
app/
├── (tabs)/
│   └── index.tsx                      (MODIFY — AI insights widget)
├── ai/
│   ├── _layout.tsx                    (AI stack)
│   ├── chat.tsx                       (chat interface)
│   ├── insights.tsx                   (spending insights)
│   └── model-manager.tsx              (download/manage models)
components/
├── ai/
│   ├── ChatBubble.tsx                 (message bubble)
│   ├── ChatInput.tsx                  (text input + send)
│   ├── InsightCard.tsx                (insight display)
│   ├── ModelDownloadCard.tsx          (model info + download)
│   ├── ModelStatusBadge.tsx           (status indicator)
│   ├── TypingIndicator.tsx            (dots animation during inference)
│   └── PremiumGate.tsx                (paywall wrapper — for future use)
stores/
├── aiStore.ts
types/
├── ai.ts
services/
├── llmService.ts
├── modelManager.ts
├── insightEngine.ts
constants/
├── models.ts
convex/
├── premium.ts
├── schema.ts                          (MODIFY)
```

---

## Step 10: Screen Specs

### app/ai/model-manager.tsx — Model Manager

**Layout:**
- "AI Models" header
- Storage usage bar (total downloaded / device storage)
- List of ModelDownloadCard components
  - Each shows: model name, size, description, RAM requirement
  - Action: Download / Delete / Set Active
  - Download shows progress bar
- Warning banner if device has low RAM for selected model

### app/ai/chat.tsx — Chat Interface

**Layout:**
- Header: model name badge, trip context selector (dropdown)
- Chat message list (FlatList, inverted)
  - User messages: right-aligned, blue background
  - Assistant messages: left-aligned, surface background
  - System messages: centered, muted
- TypingIndicator when model is generating
- ChatInput at bottom: text input + send button
- First message auto-generates: "How can I help with your expenses?"

**Data flow:**
1. User types message → addMessage to chat session
2. Build prompt: system prompt + conversation history + expense context
3. Call llmService.generateResponse with streaming
4. Stream tokens → appendInferenceProgress → shows live response
5. On completion → addMessage (assistant) with token count and time

### app/ai/insights.tsx — Spending Insights

**Layout:**
- Trip selector (horizontal chips)
- "Generate Insights" button
- List of InsightCard components
- Loading state with TypingIndicator while generating
- "Regenerate" button

**Data flow:**
1. Select trip → load expenses for that trip
2. Build insight prompt with expense data
3. Generate response → parse into Insight objects
4. Display as InsightCard list

### app/(tabs)/index.tsx — Dashboard Widget (MODIFY)

Add AI insights section:
- If premium + model downloaded: "AI Insights" card with latest 2-3 insights
- "See All" link → navigate to ai/insights
- If no model: "Download AI Assistant" CTA

---

## Step 11: Component Specs

### ChatBubble
| Prop | Type |
|------|------|
| message | ChatMessage |
| isUser | boolean |

User: right-aligned, primary color. Assistant: left-aligned, surface color.
Shows timestamp on tap. Shows token count and generation time for assistant messages.

### ChatInput
| Prop | Type |
|------|------|
| onSend | (text: string) => void |
| disabled | boolean |
| placeholder | string |

Text input with send button (arrow icon). Disabled during inference.
Auto-focuses. Multi-line with max height.

### InsightCard
| Prop | Type |
|------|------|
| insight | Insight |

Card with insight type icon, title, description. Type-based colors:
- spending_pattern → blue
- budget_suggestion → green
- category_anomaly → orange
- saving_tip → purple
- comparison → teal

### ModelDownloadCard
| Prop | Type |
|------|------|
| model | LLMModel |
| onDownload | () => void |
| onDelete | () => void |
| onSetActive | () => void |

Shows: model name, size, RAM requirement, status badge, progress bar (during download).
Actions change based on status: Download / Cancel / Delete / Set Active.

### ModelStatusBadge
| Prop | Type |
|------|------|
| status | ModelStatus |

Colors: not_downloaded → gray, downloading → blue, downloaded → green, loading → yellow, ready → green with checkmark.

### TypingIndicator

Three bouncing dots animation. Shown during inference.

### PremiumGate
| Prop | Type |
|------|------|
| children | ReactNode |
| feature | string |

For future use. Currently renders children directly (no gating).
When paywall is added: checks premium status, shows upgrade prompt if not premium.

---

## Step 12: Memory Management

**Critical considerations for on-device LLM:**

1. **Auto-unload on background**: AppState listener → when app goes to background, call `llmService.unloadModel()` to free RAM. Reload when app returns to foreground (if user is on AI screen).

2. **RAM check before loading**: Use device info to check available RAM. Show warning if device RAM < model's minRamMB.

3. **One model at a time**: Only one model loaded. Loading a new model auto-unloads the previous one.

4. **Chat history limits**: Prune chat sessions to last 50 messages each. Older messages deleted from MMKV.

5. **Context window management**: When building prompts, ensure total token count stays within n_ctx (2048). Truncate conversation history from the oldest messages if needed.

---

## Step-by-Step Build Order

1. [ ] Create `types/ai.ts`
2. [ ] Create `constants/models.ts` (model registry)
3. [ ] Add premiumStatus table to `convex/schema.ts`
4. [ ] Create `convex/premium.ts`
5. [ ] Deploy: `npx convex dev`
6. [ ] Create `services/modelManager.ts`
7. [ ] Create `services/llmService.ts`
8. [ ] Create `services/insightEngine.ts`
9. [ ] Create `stores/aiStore.ts`
10. [ ] Create `components/ai/ModelStatusBadge.tsx`
11. [ ] Create `components/ai/ModelDownloadCard.tsx`
12. [ ] Create `components/ai/TypingIndicator.tsx`
13. [ ] Create `components/ai/ChatBubble.tsx`
14. [ ] Create `components/ai/ChatInput.tsx`
15. [ ] Create `components/ai/InsightCard.tsx`
16. [ ] Create `components/ai/PremiumGate.tsx`
17. [ ] Create `app/ai/_layout.tsx`
18. [ ] Create `app/ai/model-manager.tsx`
19. [ ] Create `app/ai/chat.tsx`
20. [ ] Create `app/ai/insights.tsx`
21. [ ] Modify `app/(tabs)/index.tsx` — AI insights widget
22. [ ] Add AI entry point to settings or dashboard
23. [ ] Wire up model download with progress
24. [ ] Wire up model loading and inference
25. [ ] Wire up streaming token display in chat
26. [ ] Wire up insight generation from expense data
27. [ ] Add AppState listener for auto-unload
28. [ ] Test: download TinyLlama model (smallest)
29. [ ] Test: load model → chat with it
30. [ ] Test: stream tokens display live
31. [ ] Test: expense context — ask "How much did I spend on food?"
32. [ ] Test: generate insights for a trip
33. [ ] Test: auto-unload on background → reload on foreground
34. [ ] Test: delete model → freed storage
35. [ ] Test: switch between models
36. [ ] Run `pnpm lint`

---

## Verification

1. Model manager shows 3 available models with sizes and RAM requirements
2. Download a model → progress bar updates → file saved on device
3. Load model → "Ready" status → chat becomes available
4. Chat: send message → model generates response → tokens stream in live
5. Ask "How much did I spend on food in [trip]?" → accurate answer from expense data
6. Generate insights for a trip → 3-4 meaningful insights displayed
7. Background app → model auto-unloads (check memory usage)
8. Return to app → model reloads when AI screen opened
9. Delete model → file removed, storage freed
10. PremiumGate renders children (no blocking for now)
11. Dashboard shows latest insights when model is downloaded
