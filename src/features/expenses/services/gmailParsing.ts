import type { ImportErrorCode } from "@/features/expenses/services/importErrors";

export interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
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

const GMAIL_QUERY =
  "newer_than:50d (booking OR reservation OR flight OR airline OR hotel OR hostel OR resort OR visa OR receipt OR invoice OR payment OR transaction OR debited)";

/** Builds the Gmail search query; `since` is epoch ms, `before` epoch seconds. */
export function buildGmailQuery(since?: number | null, before?: number | null): string {
  return [
    GMAIL_QUERY,
    since ? `after:${Math.floor(since / 1000)}` : null,
    before ? `before:${before}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Epoch seconds of local midnight after the trip ends; later mail is never imported. */
export function gmailBeforeBound(endDate?: string | null): number | null {
  if (!endDate) return null;
  const [year, month, day] = endDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const nextDay = new Date(year, month - 1, day + 1);
  return Math.floor(nextDay.getTime() / 1000);
}

/** Only an invalid token or a missing scope means the grant is dead; other 403s are quota/config. */
export function gmailErrorCode(status: number, message = ""): ImportErrorCode {
  if (status === 401) return "gmail-auth";
  if (status === 403 && /insufficient|scope/i.test(message)) return "gmail-auth";
  return "gmail-api";
}

export function headerValue(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

// Gmail encodes body data as URL-safe base64. Decode to a UTF-8 string.
export function decodeBase64Url(data: string): string {
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = globalThis.atob(normalized);
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

export function decodeQuotedPrintable(value: string): string {
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

export function stripHtml(html: string): string {
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
export function extractBody(message: GmailMessage): string {
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
  return plain.join(" ").trim() || html.join(" ").trim();
}
