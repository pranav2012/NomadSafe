import type { RawMessage } from "@/features/expenses/services/transactionParser";

const SHARED_FETCH_TTL_MS = 10 * 60_000;

// `since` is epoch ms (null = full window); `before` is epoch seconds.
export interface GmailFetchRange {
  since: number | null;
  before: number | null;
}

export interface GmailFetchResult {
  messages: RawMessage[];
  /** When the fetch started; save this as the checkpoint so nothing is skipped. */
  fetchedAt: number;
}

interface SharedFetch extends GmailFetchRange {
  account: string;
  startedAt: number;
  promise: Promise<RawMessage[]>;
}

let sharedFetch: SharedFetch | null = null;

function coversRange(entry: SharedFetch, account: string, range: GmailFetchRange): boolean {
  if (entry.account !== account || entry.before !== range.before) return false;
  if (Date.now() - entry.startedAt > SHARED_FETCH_TTL_MS) return false;
  return entry.since === null || (range.since !== null && entry.since <= range.since);
}

/**
 * Expense and itinerary sync both run at launch. They share one download when a
 * recent fetch for the same account already covers the requested range, then
 * each keeps only the mail after its own checkpoint.
 */
export async function fetchTransactionEmailsShared(
  account: string,
  range: GmailFetchRange,
  load: () => Promise<RawMessage[]>,
  options: { fresh?: boolean } = {},
): Promise<GmailFetchResult> {
  let entry = sharedFetch;
  if (options.fresh || !entry || !coversRange(entry, account, range)) {
    const created: SharedFetch = { ...range, account, startedAt: Date.now(), promise: load() };
    created.promise.catch(() => {
      if (sharedFetch === created) sharedFetch = null;
    });
    sharedFetch = created;
    entry = created;
  }

  const messages = await entry.promise;
  const { since } = range;
  return {
    fetchedAt: entry.startedAt,
    messages:
      since === null
        ? messages
        : messages.filter((message) => !message.date || Date.parse(message.date) >= since),
  };
}

export function clearSharedGmailFetch(): void {
  sharedFetch = null;
}
