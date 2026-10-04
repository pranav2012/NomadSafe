import { secureStore, type SecureStoreOptions } from "@/modules/storage";
import { create } from "zustand";
import { resetAiPreference, useAiPreferenceStore } from "../preference";
import type { JsonTask } from "../schemas";
import { postJson, postStream } from "./http";
import {
  buildChatRequest,
  buildJsonRequest,
  createSseParser,
  isConfigComplete,
  parseJsonResponse,
  parseStreamData,
  type ByokConfig,
  type ByokProvider,
  type RemoteMessage,
} from "./providers";

const CONFIG_KEY = "nomadsafe.ai-byok";
// Voice capture can run from a widget before the app is unlocked, so match the MMKV key's access.
const keyOptions: SecureStoreOptions = { background: true };

export interface ByokSummary {
  provider: ByokProvider;
  model: string;
  baseUrl?: string;
}

interface ByokState {
  /** What the UI may show; the key itself never leaves SecureStore except to make a request. */
  summary: ByokSummary | null;
}

function readConfig(): ByokConfig | null {
  try {
    const raw = secureStore.getItem(CONFIG_KEY, keyOptions);
    const parsed = raw ? (JSON.parse(raw) as ByokConfig) : null;
    return isConfigComplete(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summarize(config: ByokConfig | null): ByokSummary | null {
  return config ? { provider: config.provider, model: config.model, baseUrl: config.baseUrl } : null;
}

export const useByokStore = create<ByokState>()(() => ({ summary: summarize(readConfig()) }));

export function getByokConfig(): ByokConfig | null {
  return useByokStore.getState().summary ? readConfig() : null;
}

export async function saveByokConfig(config: ByokConfig) {
  const clean: ByokConfig = {
    provider: config.provider,
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    baseUrl: config.provider === "openai_compatible" ? config.baseUrl?.trim() : undefined,
  };
  await secureStore.set(CONFIG_KEY, JSON.stringify(clean), keyOptions);
  useByokStore.setState({ summary: summarize(clean) });
}

/** Removes the saved key; a preference for it is cleared too, since the source is gone. */
export async function clearByokConfig() {
  await secureStore.remove(CONFIG_KEY, keyOptions);
  useByokStore.setState({ summary: null });
  if (useAiPreferenceStore.getState().preferred === "byok") resetAiPreference();
}

export async function byokCompleteJson(config: ByokConfig, system: string, prompt: string, task: JsonTask): Promise<string> {
  const body = await postJson(buildJsonRequest(config, system, prompt, task));
  return parseJsonResponse(config.provider, body);
}

/** Streams a chat reply; `onText` gets the accumulated text after each delta. */
export async function byokChat(
  config: ByokConfig,
  messages: RemoteMessage[],
  onText: (accumulated: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let text = "";
  let failure: unknown = null;
  const parser = createSseParser((data) => {
    if (failure) return;
    try {
      const delta = parseStreamData(config.provider, data);
      if (!delta) return;
      text += delta;
      onText(text);
    } catch (error) {
      failure = error;
    }
  });
  await postStream(buildChatRequest(config, messages), parser.push, signal);
  parser.end();
  if (failure) throw failure;
  return text;
}

/** Sends a tiny request to check the key, model and endpoint before saving them. */
export async function testByokConfig(config: ByokConfig): Promise<void> {
  await byokCompleteJson(config, "Reply with the JSON object {\"name\": \"ok\"}.", "JSON:", {
    name: "key_check",
    schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
  });
}
