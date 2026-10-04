import type { RawMessage } from "@/features/expenses/services/transactionParser";
import { ImportError } from "@/features/expenses/services/importErrors";
import {
  extractBody,
  gmailErrorCode,
  gmailRetryDelayMs,
  headerValue,
  type GmailMessage,
} from "@/features/expenses/services/gmailParsing";
import { translate } from "@/localization/translate";
import type { GmailFetchProgress } from "@/features/expenses/store/gmailSyncStatusStore";
import { logger } from "@/services/logger";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// OAuth client IDs are provided per-platform via env (see docs/expense-import.md).
export const GMAIL_CLIENT_IDS = {
  ios: process.env.EXPO_PUBLIC_GMAIL_IOS_CLIENT_ID,
  android: process.env.EXPO_PUBLIC_GMAIL_ANDROID_CLIENT_ID,
  web: process.env.EXPO_PUBLIC_GMAIL_WEB_CLIENT_ID,
} as const;

export function isGmailConfigured(): boolean {
  return Boolean(
    GMAIL_CLIENT_IDS.ios || GMAIL_CLIENT_IDS.android || GMAIL_CLIENT_IDS.web,
  );
}

const MAX_MESSAGES = 2_000;

interface GmailListResponse {
  messages?: { id: string }[];
  nextPageToken?: string;
}

const MAX_RATE_LIMIT_RETRIES = 5;
// ~140 quota units/s (a read costs 5), well under Gmail's 15,000 per user per minute.
const MIN_BATCH_MS = 350;
// RN's fetch has no timeout on Android, so one stalled request would hang the whole scan.
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_RETRIES = 1;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, accessToken: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function gmailFetch<T>(path: string, accessToken: string): Promise<T> {
  let timeouts = 0;
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, accessToken);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) throw error;
      logger.debug("gmail-import", "request timed out", { retry: timeouts < MAX_TIMEOUT_RETRIES });
      if (timeouts++ < MAX_TIMEOUT_RETRIES) continue;
      throw new ImportError("network", "Gmail request timed out");
    }
    if (response.ok) return (await response.json()) as T;

    // Surface the API's own message (e.g. SERVICE_DISABLED) instead of a bare status.
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      // non-JSON body; keep the status only
    }
    const code = gmailErrorCode(response.status, detail);
    if (code === "gmail-rate-limit" && attempt < MAX_RATE_LIMIT_RETRIES) {
      const delay = gmailRetryDelayMs(attempt, response.headers.get("Retry-After"));
      logger.debug("gmail-import", "rate limited", { attempt, delay_ms: delay });
      await wait(delay);
      continue;
    }
    throw new ImportError(code, `Gmail API error ${response.status}${detail ? `: ${detail}` : ""}`, response.status);
  }
}

export async function fetchGmailAccountEmail(accessToken: string): Promise<string | null> {
  const profile = await gmailFetch<{ emailAddress?: string }>("profile", accessToken);
  return profile.emailAddress ?? null;
}

function toRawMessage(message: GmailMessage): RawMessage {
  const subject = headerValue(message, "Subject") ?? "";
  const sender = headerValue(message, "From") ?? "";
  const bodyText = extractBody(message) || (message.snippet ?? "");
  const body = `${subject}. ${bodyText}`.trim();
  const date = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();
  return {
    body,
    date,
    sender,
    note: [
      `${translate("expenses.emailNote.from")}: ${sender || translate("expenses.emailNote.unknownSender")}`,
      `${translate("expenses.emailNote.subject")}: ${subject || translate("expenses.emailNote.noSubject")}`,
      `${translate("expenses.emailNote.received")}: ${date}`,
      "",
      bodyText,
    ].join("\n"),
    externalId: message.id ? `gmail:${message.id}` : undefined,
  };
}

/**
 * Fetches the emails matching a Gmail search as raw messages for the import pipeline.
 * Pulls the full body (text/plain or stripped HTML) plus the subject and sender,
 * giving the parser real context to extract the amount and merchant, and a
 * stable message id for dedupe.
 */
export async function fetchTransactionEmails(
  accessToken: string,
  query: string,
  report?: (progress: GmailFetchProgress) => void,
  max = MAX_MESSAGES,
): Promise<RawMessage[]> {
  const startedAt = Date.now();
  const entries: { id: string }[] = [];
  let pageToken: string | undefined;

  do {
    const pageSize = Math.min(100, max - entries.length);
    if (pageSize <= 0) break;
    const list = await gmailFetch<GmailListResponse>(
      `messages?maxResults=${pageSize}&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      accessToken,
    );
    entries.push(...(list.messages ?? []));
    pageToken = list.nextPageToken;
    report?.({ phase: "listing", done: entries.length, total: entries.length });
  } while (pageToken && entries.length < max);

  logger.debug("gmail-import", "listed", { count: entries.length, duration_ms: Date.now() - startedAt });
  if (entries.length === 0) return [];

  const messages: (GmailMessage | null)[] = [];
  const batchSize = 10;
  for (let index = 0; index < entries.length; index += batchSize) {
    const batchStart = Date.now();
    const batch = entries.slice(index, index + batchSize);
    const resolved = await Promise.all(
      batch.map((entry) =>
        gmailFetch<GmailMessage>(`messages/${entry.id}?format=full`, accessToken).catch(
          (error: unknown) => {
            // Mail deleted since listing is skipped. Any other failure aborts, so
            // the caller never checkpoints past messages it didn't read.
            if (error instanceof ImportError && error.status === 404) return null;
            throw error;
          },
        ),
      ),
    );
    messages.push(...resolved);
    report?.({ phase: "reading", done: messages.length, total: entries.length });
    const elapsed = Date.now() - batchStart;
    if (index + batchSize < entries.length && elapsed < MIN_BATCH_MS) await wait(MIN_BATCH_MS - elapsed);
  }

  logger.info("gmail-import", "fetched", { listed: entries.length, read: messages.length, duration_ms: Date.now() - startedAt });
  return messages
    .filter((message): message is GmailMessage => message != null)
    .map(toRawMessage)
    .filter((message) => message.body.length > 0);
}
