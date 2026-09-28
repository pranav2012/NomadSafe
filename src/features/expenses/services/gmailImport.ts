import type { RawMessage } from "@/features/expenses/services/transactionParser";
import { ImportError } from "@/features/expenses/services/importErrors";
import {
  buildGmailQuery,
  extractBody,
  gmailErrorCode,
  headerValue,
  type GmailMessage,
} from "@/features/expenses/services/gmailParsing";
import { translate } from "@/localization/translate";
import type { GmailFetchRange } from "@/features/expenses/services/gmailSharedFetch";

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

async function gmailFetch<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    // Surface the API's own message (e.g. SERVICE_DISABLED) instead of a bare status.
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      // non-JSON body; keep the status only
    }
    throw new ImportError(
      gmailErrorCode(response.status, detail),
      `Gmail API error ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }
  return (await response.json()) as T;
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
 * Fetches recent transactional emails as raw messages for the import pipeline.
 * Pulls the full body (text/plain or stripped HTML) plus the subject and sender,
 * giving the parser real context to extract the amount and merchant, and a
 * stable message id for dedupe.
 */
export async function fetchTransactionEmails(
  accessToken: string,
  range: GmailFetchRange,
  max = MAX_MESSAGES,
): Promise<RawMessage[]> {
  const query = buildGmailQuery(range.since, range.before);
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
  } while (pageToken && entries.length < max);

  if (entries.length === 0) return [];

  const messages: (GmailMessage | null)[] = [];
  const batchSize = 10;
  for (let index = 0; index < entries.length; index += batchSize) {
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
  }

  return messages
    .filter((message): message is GmailMessage => message != null)
    .map(toRawMessage)
    .filter((message) => message.body.length > 0);
}
