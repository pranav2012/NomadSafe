import { REMOTE_CHAT_MAX_TOKENS, REMOTE_JSON_MAX_TOKENS, type ByokProvider } from "../policy";
import type { JsonTask } from "../schemas";

export type { ByokProvider };

export interface ByokConfig {
  provider: ByokProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface RemoteMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const ANTHROPIC_VERSION = "2023-06-01";

// Reasoning models spend their output budget on thinking; keep it low for quick app replies.
const OPENAI_REASONING_MODEL = /^(gpt-[5-9]|o\d)/;
const ANTHROPIC_EFFORT_MODEL = /^claude-(opus|sonnet|fable|mythos)-(5|4-[6-9])/;

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export function isConfigComplete(config: Partial<ByokConfig> | null): config is ByokConfig {
  if (!config?.provider || !config.apiKey?.trim() || !config.model?.trim()) return false;
  if (config.provider !== "openai_compatible") return true;
  return /^https:\/\/\S+$/.test(config.baseUrl?.trim() ?? "");
}

function systemText(messages: RemoteMessage[]) {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
}

function conversation(messages: RemoteMessage[]) {
  return messages.filter((message) => message.role !== "system");
}

function openAiUrl(config: ByokConfig) {
  const base = config.provider === "openai_compatible" ? trimSlash(config.baseUrl ?? "") : "https://api.openai.com/v1";
  return `${base}/chat/completions`;
}

function openAiBody(config: ByokConfig, messages: RemoteMessage[], maxTokens: number, extra: Record<string, unknown>) {
  const official = config.provider === "openai";
  return {
    model: config.model,
    messages,
    ...(official ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(official && OPENAI_REASONING_MODEL.test(config.model) ? { reasoning_effort: "low" } : {}),
    ...extra,
  };
}

function anthropicBody(config: ByokConfig, messages: RemoteMessage[], maxTokens: number, format?: JsonTask) {
  const outputConfig: Record<string, unknown> = {};
  if (ANTHROPIC_EFFORT_MODEL.test(config.model)) outputConfig.effort = "low";
  if (format) outputConfig.format = { type: "json_schema", schema: format.schema };
  return {
    model: config.model,
    max_tokens: maxTokens,
    system: systemText(messages) || undefined,
    messages: conversation(messages),
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
  };
}

function geminiBody(messages: RemoteMessage[], maxTokens: number, format?: JsonTask) {
  const system = systemText(messages);
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: conversation(messages).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(format ? { responseMimeType: "application/json", responseJsonSchema: format.schema } : {}),
    },
  };
}

function headersFor(config: ByokConfig): Record<string, string> {
  switch (config.provider) {
    case "anthropic":
      return { "x-api-key": config.apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" };
    case "gemini":
      return { "x-goog-api-key": config.apiKey, "content-type": "application/json" };
    default:
      return { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" };
  }
}

function geminiUrl(config: ByokConfig, stream: boolean) {
  const model = encodeURIComponent(config.model);
  return stream
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/** One structured completion: system + user prompt, constrained to the task's JSON schema. */
export function buildJsonRequest(config: ByokConfig, system: string, prompt: string, task: JsonTask): HttpRequest {
  const messages: RemoteMessage[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
  const headers = headersFor(config);
  switch (config.provider) {
    case "anthropic":
      return { url: "https://api.anthropic.com/v1/messages", headers, body: JSON.stringify(anthropicBody(config, messages, REMOTE_JSON_MAX_TOKENS, task)) };
    case "gemini":
      return { url: geminiUrl(config, false), headers, body: JSON.stringify(geminiBody(messages, REMOTE_JSON_MAX_TOKENS, task)) };
    default: {
      // Compatible endpoints don't all support strict schemas; JSON mode plus the prompt is the common ground.
      const responseFormat =
        config.provider === "openai"
          ? { type: "json_schema", json_schema: { name: task.name, strict: true, schema: task.schema } }
          : { type: "json_object" };
      return { url: openAiUrl(config), headers, body: JSON.stringify(openAiBody(config, messages, REMOTE_JSON_MAX_TOKENS, { response_format: responseFormat })) };
    }
  }
}

export function buildChatRequest(config: ByokConfig, messages: RemoteMessage[]): HttpRequest {
  const headers = headersFor(config);
  switch (config.provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers,
        body: JSON.stringify({ ...anthropicBody(config, messages, REMOTE_CHAT_MAX_TOKENS), stream: true }),
      };
    case "gemini":
      return { url: geminiUrl(config, true), headers, body: JSON.stringify(geminiBody(messages, REMOTE_CHAT_MAX_TOKENS)) };
    default:
      return { url: openAiUrl(config), headers, body: JSON.stringify(openAiBody(config, messages, REMOTE_CHAT_MAX_TOKENS, { stream: true })) };
  }
}

type Json = Record<string, any>;

function geminiText(body: Json): string {
  const parts: Json[] = body?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/** Text of a non-streamed response; throws when the provider returned none. */
export function parseJsonResponse(provider: ByokProvider, body: Json): string {
  let text = "";
  if (provider === "anthropic") {
    text = ((body?.content ?? []) as Json[])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  } else if (provider === "gemini") {
    text = geminiText(body);
  } else {
    text = body?.choices?.[0]?.message?.content ?? "";
  }
  if (!text) throw new Error(`${provider} returned no text`);
  return text;
}

/** Text delta in one SSE `data:` payload of a streamed chat reply ("" for non-text events). */
export function parseStreamData(provider: ByokProvider, data: string): string {
  if (data === "[DONE]") return "";
  let event: Json;
  try {
    event = JSON.parse(data);
  } catch {
    return "";
  }
  if (event?.error) throw new Error(`${provider} stream error: ${event.error.message ?? event.error.type ?? "unknown"}`);
  if (provider === "anthropic") {
    return event.type === "content_block_delta" && event.delta?.type === "text_delta" ? (event.delta.text ?? "") : "";
  }
  if (provider === "gemini") return geminiText(event);
  return event?.choices?.[0]?.delta?.content ?? "";
}

/** Splits a stream of SSE text into its `data:` payloads, across chunk boundaries. */
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) onData(line.slice(5).trim());
      }
    },
    end() {
      if (buffer.startsWith("data:")) onData(buffer.slice(5).trim());
      buffer = "";
    },
  };
}
