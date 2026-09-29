import type PostHog from "posthog-react-native";

/** Counts, enums and booleans only, never user content or coordinates. */
export type LogAttributes = Record<string, string | number | boolean | null | undefined>;

type Level = "debug" | "info" | "warn" | "error";

/** Lazy, so headless background launches don't create the client (and an "Application Opened" event) unless they log. */
function client(): PostHog | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("@/services/analytics") as typeof import("@/services/analytics")).posthog;
}

/** Error name plus a scrubbed message; URLs and quoted text can carry tokens or user content. */
function describeError(error: unknown): LogAttributes {
  if (error === undefined) return {};
  if (!(error instanceof Error)) return { error_name: typeof error };
  const message = error.message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "<redacted>")
    .slice(0, 200);
  return { error_name: error.name, error_message: message };
}

function emit(level: Level, tag: string, message: string, error?: unknown, attributes?: LogAttributes) {
  if (__DEV__) {
    const extra = [error, attributes].filter((value) => value !== undefined);
    (level === "error" ? console.warn : console[level])(`[${tag}] ${message}`, ...extra);
    return;
  }
  const posthog = client();
  if (!posthog) return;
  posthog.logger[level](`[${tag}] ${message}`, { tag, ...attributes, ...describeError(error) });
  if (level === "error") posthog.captureException(error ?? new Error(message), { tag });
}

/** Console in dev; PostHog Logs (plus error tracking for `error`) in production, honouring the analytics opt-out. */
export const logger = {
  debug: (tag: string, message: string, attributes?: LogAttributes) =>
    emit("debug", tag, message, undefined, attributes),
  info: (tag: string, message: string, attributes?: LogAttributes) =>
    emit("info", tag, message, undefined, attributes),
  warn: (tag: string, message: string, error?: unknown, attributes?: LogAttributes) =>
    emit("warn", tag, message, error, attributes),
  error: (tag: string, message: string, error?: unknown, attributes?: LogAttributes) =>
    emit("error", tag, message, error, attributes),
};

/** Flattens `{ reason: count }` into `prefix_reason` attributes. */
export function countAttributes(prefix: string, counts: Record<string, number>): LogAttributes {
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [`${prefix}_${key}`, value]));
}
