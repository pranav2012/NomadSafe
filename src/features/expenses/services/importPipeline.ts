import {
  buildDedupeIndex,
  expenseFingerprint,
  useExpensesStore,
  type CreateExpenseInput,
  type ExpenseSource,
} from "@/features/expenses/store/expensesStore";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import {
  categorizeExpense,
  categorizeHeuristic,
} from "@/features/expenses/services/categorizer";
import {
  merchantFromSender,
  parseTransaction,
  type RawMessage,
} from "@/features/expenses/services/transactionParser";
import { matchEmailProvider } from "@/features/expenses/services/emailProviders";
import type { Trip } from "@/features/trips/store/tripsStore";
import {
  conversionNote,
  fetchExchangeRate,
} from "@/features/expenses/services/currencyConversion";
import { translate } from "@/localization/translate";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";

// Local model calls are slow; only unmatched candidates use it, capped per import.
const MAX_MODEL_CALLS = 20;

export interface BuildCandidatesOptions {
  /** When false, skip the local LLM and categorize with the keyword heuristic
   *  only — used for background sync to avoid loading the model at launch. */
  allowModel?: boolean;
  /** Gmail is scoped to the selected trip so unrelated payments never enter its ledger. */
  trip?: Trip | null;
}

export interface ImportCandidate {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  date: string;
  source: ExpenseSource;
  rawText: string;
  note?: string;
  preview: string;
  externalId?: string;
  /** Confirmed booking whose payment may still be pending (noted on import). */
  committedBooking: boolean;
  autoCategorized: boolean;
  viaModel: boolean;
  duplicate: boolean;
  selected: boolean;
}

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function messageMentionsDestination(message: RawMessage, trip: Trip): boolean {
  const email = normalizedText([message.body, message.sender].filter(Boolean).join(" "));
  return trip.destinations.some((destination) => {
    const destinationParts = normalizedText(destination)
      .split(/[,/()\-]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3);
    const meaningfulTokens = destinationParts.flatMap((part) =>
      part
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !["city", "municipality", "subdistrict"].includes(token)),
    );
    return [...destinationParts, ...meaningfulTokens].some((part) => email.includes(part));
  });
}

function messageDateKey(message: RawMessage): string | null {
  if (!message.date || Number.isNaN(new Date(message.date).getTime())) return null;
  return toLocalDayKey(message.date);
}

function isPreTripBooking(message: RawMessage): boolean {
  return /\b(?:flight|airline|airport|boarding|hotel|hostel|resort|accommodation|check[- ]?in|reservation|booking|visa|e-visa|immigration|consulate|passport)\b/i.test(
    [message.body, message.sender].filter(Boolean).join(" "),
  );
}

function tripMatchReason(message: RawMessage, trip: Trip): string | null {
  const date = messageDateKey(message);
  const startDate = trip.startDate.slice(0, 10);
  const endDate = trip.endDate.slice(0, 10);
  if (!date) return "invalid-email-date";
  if (date > endDate) return "after-trip";

  if (date >= startDate) return null;

  if (!isPreTripBooking(message)) return "pretrip-not-booking";
  return messageMentionsDestination(message, trip) ? null : "pretrip-destination-mismatch";
}

/**
 * Turns raw bank/card alerts and emails into reviewable expense candidates: parses
 * each debit, categorizes it (heuristic + local model), and flags ones that
 * already exist so the user can deselect duplicates before importing.
 */
export async function buildImportCandidates(
  messages: RawMessage[],
  source: ExpenseSource,
  options: BuildCandidatesOptions = {},
): Promise<ImportCandidate[]> {
  const { allowModel = true } = options;
  const dedupe = buildDedupeIndex(useExpensesStore.getState().expenses);
  const model = { calls: 0, disabled: !allowModel };
  const candidates: ImportCandidate[] = [];
  const seen = new Set<string>();
  const diagnostics = { tripMatched: 0, parsedDebits: 0, rejected: {} as Record<string, number> };
  let loggedRejections = 0;

  if (source === "email") {
    console.info("[gmail-import] scan", {
      messages: messages.length,
      activeTrip: options.trip
        ? {
            id: options.trip.id,
            destinations: options.trip.destinations,
            startDate: options.trip.startDate,
            endDate: options.trip.endDate,
          }
        : null,
    });
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (source === "email") {
      const reason = options.trip ? tripMatchReason(message, options.trip) : "no-active-trip";
      if (reason) {
        diagnostics.rejected[reason] = (diagnostics.rejected[reason] ?? 0) + 1;
        if (loggedRejections < 20 && isPreTripBooking(message)) {
          console.info("[gmail-import] rejected", {
            id: message.externalId,
            date: message.date,
            reason,
          });
          loggedRejections += 1;
        }
        continue;
      }
      diagnostics.tripMatched += 1;
    }
    const parsed = parseTransaction(message.body, message.date, {
      currencyHint: options.trip?.currency,
    });
    if (!parsed || parsed.kind !== "debit") {
      if (source === "email") {
        diagnostics.rejected["not-a-debit"] = (diagnostics.rejected["not-a-debit"] ?? 0) + 1;
      }
      continue;
    }
    if (source === "email") diagnostics.parsedDebits += 1;

    // Prefer the parsed merchant; fall back to the email sender when the body
    // doesn't name a clear "at <merchant>".
    const provider = source === "email" ? matchEmailProvider(message.body, message.sender) : null;
    const merchant = provider?.merchant || parsed.merchant || merchantFromSender(message.sender);

    const date = parsed.occurredAt;
    const fingerprint = expenseFingerprint({ merchant, amount: parsed.amount, date });
    // A stable source id (Gmail message id / pasted body hash) keeps two genuine
    // same-day, same-amount purchases apart; the fingerprint is the fallback.
    const dedupeKey = message.externalId ?? fingerprint;

    // Skip exact repeats inside this same batch.
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const duplicate =
      dedupe.fingerprints.has(fingerprint) ||
      Boolean(message.externalId && dedupe.externalIds.has(message.externalId));

    const { category, viaModel } = await categorizeCandidate(merchant, parsed.raw, provider?.category, model);

    candidates.push({
      id: message.externalId ?? `${date}-${index}`,
      merchant,
      amount: parsed.amount,
      currency: parsed.currency,
      category,
      date,
      source,
      rawText: parsed.raw,
      note: message.note,
      preview: parsed.raw.slice(0, 120),
      externalId: message.externalId,
      committedBooking: Boolean(provider?.committedBooking),
      autoCategorized: true,
      viaModel,
      duplicate,
      selected: !duplicate,
    });
  }

  if (source === "email") {
    console.info("[gmail-import] result", {
      ...diagnostics,
      candidates: candidates.length,
    });
  }

  return candidates;
}

async function categorizeCandidate(
  merchant: string,
  rawText: string,
  providerCategory: ExpenseCategory | undefined,
  model: { calls: number; disabled: boolean },
): Promise<{ category: ExpenseCategory; viaModel: boolean }> {
  if (providerCategory) return { category: providerCategory, viaModel: false };

  const heuristic = categorizeHeuristic({ merchant, rawText });
  if (heuristic.matched || model.disabled || model.calls >= MAX_MODEL_CALLS) {
    return { category: heuristic.category, viaModel: false };
  }

  model.calls += 1;
  const result = await categorizeExpense({ merchant, rawText });
  // One failed load means the model is unavailable; don't retry per candidate.
  if (result.modelFailed) model.disabled = true;
  return { category: result.category, viaModel: result.viaModel };
}

// FNV-1a; a short stable id for a pasted alert body.
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Splits free-text (multiple pasted alerts) into individual messages. */
export function splitPastedMessages(text: string): RawMessage[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0)
    .map((body) => ({ body, externalId: `paste:${hashText(body.toLowerCase())}` }));
}

export async function candidateToInput(
  candidate: ImportCandidate,
  tripId: string | null,
  tripCurrency?: string,
): Promise<CreateExpenseInput> {
  let note = candidate.committedBooking
    ? [translate("expenses.committedBookingNote"), candidate.note].filter(Boolean).join("\n\n")
    : candidate.note;
  if (candidate.source === "email" && tripCurrency && candidate.currency !== tripCurrency) {
    try {
      const rate = await fetchExchangeRate(candidate.currency, tripCurrency, candidate.date);
      note = [note, conversionNote(candidate.amount, candidate.currency, tripCurrency, rate)]
        .filter(Boolean)
        .join("\n\n");
    } catch {
      // The original expense remains valid when a reference rate is unavailable.
    }
  }

  return {
    tripId,
    merchant: candidate.merchant || translate("expenses.unknownMerchant"),
    amount: candidate.amount,
    currency: candidate.currency,
    category: candidate.category,
    date: candidate.date,
    source: candidate.source,
    autoCategorized: candidate.autoCategorized,
    rawText: candidate.rawText,
    note,
    externalId: candidate.externalId,
    location: null,
  };
}
