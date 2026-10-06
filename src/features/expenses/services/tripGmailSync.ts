import { ensureGmailAccountEmail, withGmailAccess } from "@/features/expenses/services/gmailAuth";
import { fetchGmailAttachment, fetchTransactionEmails } from "@/features/expenses/services/gmailImport";
import { MAX_TICKET_BYTES, hasGmailTicket, pruneTickets, saveGmailTicket } from "@/features/itinerary/services/tickets";
import { buildTripGmailQuery } from "@/features/expenses/services/gmailParsing";
import { importErrorCode } from "@/features/expenses/services/importErrors";
import { buildImportCandidates, candidateToInput } from "@/features/expenses/services/importPipeline";
import { clearLegacyGmailCheckpoints } from "@/features/expenses/services/legacyGmailCheckpoints";
import { GMAIL_PARSER_VERSION, coverageAfterScan, nextGmailScanWindow } from "@/features/expenses/services/tripGmailCoverage";
import type { RawMessage } from "@/features/expenses/services/transactionParser";
import { useExpensesStore, type CreateExpenseInput } from "@/features/expenses/store/expensesStore";
import { parseParty, planAutoSplit } from "@/features/expenses/utils/party";
import { SELF_ID } from "@/features/expenses/utils/split";
import { useAuthStore } from "@/features/auth/store/authStore";
import { hasGmailGrant, hydrateGmailConnection, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";
import { updateTripGmailSyncStatus } from "@/features/expenses/store/gmailSyncStatusStore";
import { getTripGmailCoverage, setTripGmailCoverage } from "@/features/expenses/store/tripGmailCoverageStore";
import { buildEventCandidates } from "@/features/itinerary/services/itineraryExtraction";
import { parseBookingEmail } from "@/features/itinerary/services/bookingEmailParser";
import { isGenericTitle } from "@/features/itinerary/utils/bookings";
import { transitModeOf } from "@/features/itinerary/utils/transit";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { useEventsStore, type EmailMergeResult } from "@/features/itinerary/store/eventsStore";
import { useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";

export interface TripGmailSyncResult {
  scanned: boolean;
  expensesAdded: number;
  eventsAdded: number;
}

const inFlight = new Map<string, Promise<TripGmailSyncResult | null>>();

/** Reads the trip's unscanned Gmail mail once into new spends and events; null when Gmail isn't connected. */
export function syncTripGmail(trip: Trip): Promise<TripGmailSyncResult | null> {
  const running = inFlight.get(trip.id);
  if (running) return running;
  const task = runSync(trip).finally(() => inFlight.delete(trip.id));
  inFlight.set(trip.id, task);
  return task;
}

async function runSync(trip: Trip): Promise<TripGmailSyncResult | null> {
  await hydrateGmailConnection();
  if (!hasGmailGrant(useGmailConnectionStore.getState().tokens)) return null;
  void clearLegacyGmailCheckpoints();

  await ensureGmailAccountEmail();
  const account = useGmailConnectionStore.getState().tokens?.email ?? "unknown";
  const previous = getTripGmailCoverage(trip.id);
  const window = nextGmailScanWindow(trip, previous, account, Date.now());
  if (!window) {
    logger.debug("gmail-sync", "up to date", { has_coverage: Boolean(previous) });
    updateTripGmailSyncStatus(trip.id, { state: "done", progress: null, errorCode: null });
    return { scanned: false, expensesAdded: 0, eventsAdded: 0 };
  }

  updateTripGmailSyncStatus(trip.id, { state: "syncing", progress: null, errorCode: null });
  logger.debug("gmail-sync", "start", { full: !previous, window_days: Math.round((window.before - window.after) / 86_400_000) });
  try {
    const query = buildTripGmailQuery(trip, window.after, window.before);
    const fetched = query
      ? await withGmailAccess((accessToken) =>
          fetchTransactionEmails(accessToken, query, (progress) => updateTripGmailSyncStatus(trip.id, { progress })),
        )
      : [];
    // Oldest first, so updates and cancellations are applied after the booking they change.
    const messages = [...fetched].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    // A first scan or a newer parser re-reads the trip: unedited Gmail events are rebuilt from scratch.
    const reparse = !previous || previous.parserVersion !== GMAIL_PARSER_VERSION;
    if (reparse) useEventsStore.getState().removeUneditedEmailEvents(trip.id);
    const cancelledIds = cancelledConfirmationIds(messages);
    const expensesAdded = await addNewExpenses(
      messages.filter((message) => !message.externalId || !cancelledIds.includes(message.externalId)),
      trip,
    );
    const { added: eventsAdded, removedSourceIds } = await addNewEvents(messages, trip);
    await attachGmailTickets(messages, trip).catch((error: unknown) => logger.warn("gmail-sync", "tickets failed", error));
    // A rescan rebuilds unedited bookings under new ids; their old tickets go (the new ones were just saved).
    if (reparse) await pruneTickets();
    const expensesRemoved =
      removeCancelledExpenses([...removedSourceIds, ...cancelledIds], trip.id) + removeGenericDuplicates(trip.id);
    if (reparse) autoSplitExisting(trip);

    // A trip deleted mid-sync must not leave coverage behind.
    if (useTripsStore.getState().trips.some((item) => item.id === trip.id)) {
      setTripGmailCoverage(trip.id, coverageAfterScan(trip, account, window, previous));
    }
    updateTripGmailSyncStatus(trip.id, (current) => ({
      state: "done",
      progress: null,
      unseenExpenses: current.unseenExpenses + Math.max(0, expensesAdded - expensesRemoved),
    }));
    logger.info("gmail-sync", "done", {
      incremental: Boolean(previous && window.after > previous.from),
      window_days: Math.round((window.before - window.after) / 86_400_000),
      messages: messages.length,
      expenses_added: expensesAdded,
      expenses_removed: expensesRemoved,
      events_added: eventsAdded,
    });
    return { scanned: true, expensesAdded, eventsAdded };
  } catch (error) {
    updateTripGmailSyncStatus(trip.id, { state: "failed", progress: null, errorCode: importErrorCode(error) });
    logger.warn("gmail-sync", "failed", error);
    throw error;
  }
}

async function addNewExpenses(messages: RawMessage[], trip: Trip): Promise<number> {
  const candidates = await buildImportCandidates(messages, "email", { allowModel: false, trip });
  const fresh = candidates.filter((candidate) => !candidate.duplicate);
  if (fresh.length === 0) return 0;
  const bodies = new Map(messages.map((message) => [message.externalId, message.body]));
  const inputs = await Promise.all(
    fresh.map(async (candidate) => {
      const input = await candidateToInput(candidate, trip.id, trip.currency);
      return { ...input, ...autoSplitFields(bodies.get(candidate.externalId) ?? input.note ?? "", input, trip) };
    }),
  );
  const added = useExpensesStore.getState().addExpenses(inputs);
  if (added.length > 0) track("expense_added", { source: "gmail_auto", count: added.length });
  return added.length;
}

async function addNewEvents(messages: RawMessage[], trip: Trip): Promise<EmailMergeResult> {
  const candidates = await buildEventCandidates(messages, "email", { trip });
  const fresh = candidates.filter((candidate) => !candidate.duplicate);
  if (fresh.length === 0) return { added: 0, removedSourceIds: [] };
  const result = useEventsStore.getState().mergeEmailEvents(
    fresh.map((candidate) => ({
      tripId: trip.id,
      type: candidate.type,
      title: candidate.title,
      detail: candidate.detail,
      transitMode: candidate.transitMode,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      // Flight tickets are per person: on a trip with others, a flight from your inbox is yours.
      people: trip.companions.length > 0 && transitModeOf(candidate) === "flight" ? [SELF_ID] : undefined,
      source: candidate.source,
      note: candidate.note,
      rawText: candidate.rawText,
      externalId: candidate.externalId,
      bookingRef: candidate.bookingRef,
      cancelled: candidate.cancelled,
    })),
  );
  if (result.added > 0) track("itinerary_event_added", { source: "gmail", count: result.added });
  return result;
}

/** Saves each booking email's PDFs (tickets, vouchers) on the items it created or merged into; files stay on the phone. */
async function attachGmailTickets(messages: RawMessage[], trip: Trip): Promise<number> {
  const events = useEventsStore.getState().events.filter((event) => event.tripId === trip.id && event.source === "email");
  let saved = 0;
  for (const message of messages) {
    const files = (message.attachments ?? []).filter((file) => file.size <= MAX_TICKET_BYTES);
    if (!message.externalId || files.length === 0) continue;
    const fromThisEmail = (id: string | undefined) => Boolean(id?.startsWith(`${message.externalId}#`));
    const targets = events.filter((event) => fromThisEmail(event.externalId) || event.sourceIds?.some(fromThisEmail));
    if (targets.length === 0) continue;
    const messageId = message.externalId.slice("gmail:".length);
    for (const file of files) {
      const key = `${message.externalId}:${file.name}`;
      const missing = targets.filter((event) => !hasGmailTicket(event.id, key));
      if (missing.length === 0) continue;
      const data = await withGmailAccess((accessToken) => fetchGmailAttachment(accessToken, messageId, file.attachmentId));
      for (const event of missing) {
        if (await saveGmailTicket(event.id, key, file.name, data)) saved += 1;
      }
    }
  }
  if (saved > 0) {
    logger.info("gmail-sync", "tickets saved", { count: saved });
    track("ticket_added", { source: "gmail", count: saved });
  }
  return saved;
}

/** Split fields for a Gmail spend you paid, from the email's head-count and guest names. */
function autoSplitFields(
  text: string,
  spend: { amount: number; currency: string },
  trip: Trip,
): Pick<CreateExpenseInput, "paidBy" | "shares" | "splitHint"> {
  const plan = planAutoSplit(parseParty(text), {
    amount: spend.amount,
    currency: spend.currency,
    companions: trip.companions,
    selfName: useAuthStore.getState().user?.name,
    shared: Boolean(trip.shared),
  });
  if (!plan) return {};
  return plan.kind === "split" ? { paidBy: SELF_ID, shares: plan.shares } : { splitHint: plan.hint };
}

/** One pass over the trip's earlier Gmail spends that were never split, using their stored email text. */
function autoSplitExisting(trip: Trip): void {
  const { expenses, updateExpense } = useExpensesStore.getState();
  for (const expense of expenses) {
    if (expense.tripId !== trip.id || expense.source !== "email" || expense.shares?.length || expense.splitHint) continue;
    const fields = autoSplitFields(expense.note ?? expense.rawText ?? "", expense, trip);
    if (fields.shares || fields.splitHint) updateExpense(expense.id, fields);
  }
}

/**
 * A booking site's receipt ("Booking", ¥17,367) duplicates the named confirmation spend
 * ("Maple Leaf Hostel", ¥17,367, same day); keeps the named one.
 */
function removeGenericDuplicates(tripId: string): number {
  const { expenses, deleteExpense } = useExpensesStore.getState();
  const email = expenses.filter((expense) => expense.tripId === tripId && expense.source === "email");
  const key = (expense: (typeof email)[number]) => `${expense.currency}|${expense.amount.toFixed(2)}|${toLocalDayKey(expense.date)}`;
  const named = new Set(email.filter((expense) => !isGenericTitle(expense.merchant)).map(key));
  const duplicates = email.filter((expense) => isGenericTitle(expense.merchant) && named.has(key(expense)));
  for (const expense of duplicates) deleteExpense(expense.id);
  return duplicates.length;
}

/** Message ids of confirmation emails whose booking number has a cancellation email in the same batch. */
function cancelledConfirmationIds(messages: RawMessage[]): string[] {
  const parsed = messages.map((message) => ({ id: message.externalId, bookings: parseBookingEmail(message).bookings }));
  const cancelledRefs = new Set(
    parsed.flatMap(({ bookings }) => bookings.filter((b) => b.cancelled && b.bookingRef).map((b) => b.bookingRef)),
  );
  return parsed
    .filter(({ id, bookings }) => id && bookings.some((b) => !b.cancelled && b.bookingRef && cancelledRefs.has(b.bookingRef)))
    .map(({ id }) => id as string);
}

/** Drops Gmail spends imported from the confirmation of a booking that was later cancelled. */
function removeCancelledExpenses(sourceIds: string[], tripId: string): number {
  // Event source ids are "gmail:<message>#<n>"; the spend from that email is "gmail:<message>".
  const messageIds = new Set(sourceIds.map((id) => id.replace(/#\d+$/, "")));
  if (messageIds.size === 0) return 0;
  const { expenses, deleteExpense } = useExpensesStore.getState();
  const cancelled = expenses.filter(
    (expense) => expense.tripId === tripId && expense.source === "email" && expense.externalId && messageIds.has(expense.externalId),
  );
  for (const expense of cancelled) deleteExpense(expense.id);
  return cancelled.length;
}
