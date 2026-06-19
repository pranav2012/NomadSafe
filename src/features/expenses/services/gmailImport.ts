import type { RawMessage } from "@/features/expenses/services/transactionParser";

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

const GMAIL_QUERY =
  "newer_than:50d (booking OR reservation OR flight OR airline OR hotel OR hostel OR resort OR visa OR receipt OR invoice OR payment OR transaction OR debited)";
const MAX_MESSAGES = 2_000;

interface GmailListResponse {
  messages?: { id: string }[];
  nextPageToken?: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailPart[];
  };
}

function headerValue(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

// Gmail encodes body data as URL-safe base64. Decode to a UTF-8 string.
function decodeBase64Url(data: string): string {
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = globalThis.atob(normalized);
    // Reconstruct UTF-8 from the binary string produced by atob.
    return decodeURIComponent(
      binary
        .split("")
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(""),
    );
  } catch {
    return "";
  }
}

function decodeQuotedPrintable(value: string): string {
  const binary = value
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  try {
    return decodeURIComponent(
      binary
        .split("")
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
  } catch {
    return binary;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

// Walk the MIME tree, preferring text/plain and falling back to stripped HTML.
function extractBody(message: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];

  const visit = (part?: GmailPart | GmailMessage["payload"]) => {
    if (!part) return;
    const data = part.body?.data;
    if (data) {
      if (part.mimeType === "text/plain") plain.push(decodeBase64Url(data));
      else if (part.mimeType === "text/html") html.push(stripHtml(decodeQuotedPrintable(decodeBase64Url(data))));
    }
    part.parts?.forEach(visit);
  };

  visit(message.payload);
  const text = plain.join(" ").trim() || html.join(" ").trim();
  return text;
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
      detail = body.error?.message ? `: ${body.error.message}` : "";
    } catch {
      // non-JSON body; keep the status only
    }
    throw new Error(`Gmail API error ${response.status}${detail}`);
  }
  return (await response.json()) as T;
}

/**
 * Fetches recent transactional emails as raw messages for the import pipeline.
 * Pulls the full body (text/plain or stripped HTML) plus the subject and sender,
 * giving the parser real context to extract the amount and merchant, and a
 * stable message id for dedupe.
 */
export async function fetchTransactionEmails(
  accessToken: string,
  since?: number | null,
  max = MAX_MESSAGES,
): Promise<RawMessage[]> {
  const query = since ? `${GMAIL_QUERY} after:${Math.floor(since / 1000)}` : GMAIL_QUERY;
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
          () => null,
        ),
      ),
    );
    messages.push(...resolved);
  }

  return messages
    .filter((message): message is GmailMessage => message != null)
    .map((message) => {
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
        note: `From: ${sender || "Unknown"}\nSubject: ${subject || "(no subject)"}\nReceived: ${date}\n\n${bodyText}`,
        externalId: message.id ? `gmail:${message.id}` : undefined,
      };
    })
    .filter((message) => message.body.length > 0);
}
