import { fetch } from "expo/fetch";
import type { HttpRequest } from "./providers";

export const JSON_TIMEOUT_MS = 30_000;
// A streamed reply must start within this; once tokens flow it may take longer.
export const FIRST_CHUNK_TIMEOUT_MS = 30_000;
export const STREAM_TIMEOUT_MS = 120_000;

export class RemoteAiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RemoteAiError";
  }
}

async function errorFrom(res: Response): Promise<RemoteAiError> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const code = typeof body?.error === "string" ? body.error : undefined;
  return new RemoteAiError(`HTTP ${res.status}`, res.status, code);
}

/** Abort controller that also fires when `outer` aborts or `ms` passes; `clear` stops the timer. */
function linkedAbort(outer: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  outer?.addEventListener("abort", onAbort);
  let timer = setTimeout(onAbort, ms);
  return {
    signal: controller.signal,
    reset(next: number) {
      clearTimeout(timer);
      timer = setTimeout(onAbort, next);
    },
    clear() {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

export async function postJson(request: HttpRequest, timeoutMs = JSON_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const abort = linkedAbort(undefined, timeoutMs);
  try {
    const res = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: abort.signal });
    if (!res.ok) throw await errorFrom(res as unknown as Response);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    abort.clear();
  }
}

/**
 * POSTs and feeds the decoded response body to `onText` as it arrives. Resolves when the stream
 * ends; aborting `signal` ends it early without an error.
 */
export async function postStream(request: HttpRequest, onText: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
  const abort = linkedAbort(signal, FIRST_CHUNK_TIMEOUT_MS);
  try {
    const res = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: abort.signal });
    if (!res.ok || !res.body) throw await errorFrom(res as unknown as Response);
    abort.reset(STREAM_TIMEOUT_MS);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onText(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  } finally {
    abort.clear();
  }
}
