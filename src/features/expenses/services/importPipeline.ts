import {
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
  return new Date(message.date).toISOString().slice(0, 10);
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
 * Turns raw bank/UPI/card messages into reviewable expense candidates: parses
 * each debit, categorizes it (heuristic + local model), and flags ones that
 * already exist so the user can deselect duplicates before importing.
 */
export async function buildImportCandidates(
  messages: RawMessage[],
  source: ExpenseSource,
  options: BuildCandidatesOptions = {},
): Promise<ImportCandidate[]> {
  const { allowModel = true } = options;
  const { hasFingerprint, hasExternalId } = useExpensesStore.getState();
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
    const parsed = parseTransaction(message.body, message.date);
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
    // A stable source id (Gmail message id) dedupes far more reliably than a
    // merchant+amount+day fingerprint; use it when present.
    const dedupeKey = message.externalId ?? fingerprint;

    // Skip exact repeats inside this same batch.
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const duplicate = hasFingerprint(fingerprint) || Boolean(message.externalId && hasExternalId(message.externalId));

    const { category, viaModel } = provider?.category
      ? { category: provider.category, viaModel: false }
      : allowModel
      ? await categorizeExpense({ merchant, rawText: parsed.raw })
      : { category: categorizeHeuristic({ merchant, rawText: parsed.raw }).category, viaModel: false };

    candidates.push({
      id: message.externalId ?? `${date}-${index}`,
      merchant,
      amount: parsed.amount,
      currency: parsed.currency,
      category,
      date,
      source,
      rawText: parsed.raw,
      note: provider?.committedBooking
        ? ["Confirmed booking total; payment may still be pending.", message.note]
            .filter(Boolean)
            .join("\n\n")
        : message.note,
      preview: parsed.raw.slice(0, 120),
      externalId: message.externalId,
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

/** Splits free-text (multiple pasted alerts) into individual messages. */
export function splitPastedMessages(text: string): RawMessage[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0)
    .map((body) => ({ body }));
}

export async function candidateToInput(
  candidate: ImportCandidate,
  tripId: string | null,
  tripCurrency?: string,
): Promise<CreateExpenseInput> {
  let note = candidate.note;
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
    merchant: candidate.merchant || "Unknown",
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
