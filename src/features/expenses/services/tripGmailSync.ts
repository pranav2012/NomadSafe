import { ensureGmailAccountEmail, withGmailAccess } from "@/features/expenses/services/gmailAuth";
import { fetchTransactionEmails } from "@/features/expenses/services/gmailImport";
import { buildTripGmailQuery } from "@/features/expenses/services/gmailParsing";
import { drainGmailTickets, queueGmailTickets } from "@/features/expenses/services/gmailTickets";
import { importErrorCode } from "@/features/expenses/services/importErrors";
import { buildImportCandidates, type ImportCandidate } from "@/features/expenses/services/importPipeline";
import { clearLegacyGmailCheckpoints } from "@/features/expenses/services/legacyGmailCheckpoints";
import { pocketOfExpense } from "@/features/expenses/services/forexPockets";
import { tripSpendContext, type TripSpendContext } from "@/features/expenses/services/tripEmailFilter";
import { GMAIL_PARSER_VERSION, coverageAfterScan, nextGmailScanWindow } from "@/features/expenses/services/tripGmailCoverage";
import type { RawMessage } from "@/features/expenses/services/transactionParser";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useGmailInboxStore, type GmailFileRef, type GmailProposal } from "@/features/expenses/store/gmailInboxStore";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";
import { trimStoredEmailText } from "@/features/expenses/utils/emailText";
import {
  defaultSpendSplit,
  emailSenderName,
  eventMessageIds,
  findSameBooking,
  isBookingSpend,
  isDismissedBooking,
  isRepeatSpend,
  isUntouchedImportedExpense,
  selectReturnableEvents,
  spendKey,
} from "@/features/expenses/utils/gmailReview";
import { SELF_ID } from "@/features/expenses/utils/split";
import { useAuthStore } from "@/features/auth/store/authStore";
import { hasGmailGrant, hydrateGmailConnection, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";
import { updateTripGmailSyncStatus } from "@/features/expenses/store/gmailSyncStatusStore";
import { getTripGmailCoverage, setTripGmailCoverage } from "@/features/expenses/store/tripGmailCoverageStore";
import { buildEventCandidates } from "@/features/itinerary/services/itineraryExtraction";
import { parseBookingEmail } from "@/features/itinerary/services/bookingEmailParser";
import { pruneTickets } from "@/features/itinerary/services/tickets";
import { useEventsStore, type CreateEventInput, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";
import { isGenericTitle, mergeBooking, sameBooking } from "@/features/itinerary/utils/bookings";
import { mergeTravelDetails } from "@/features/itinerary/utils/travelDetails";
import { transitModeOf } from "@/features/itinerary/utils/transit";
import { homeCountryCode, placeCountry } from "@/features/passport/hooks/usePassport";
import { countryFacts } from "@/features/trips/utils/countryFacts";
import { getDestinationCoordinates, useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { getCurrentLocale, translate } from "@/localization/translate";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";

export interface TripGmailSyncResult {
  scanned: boolean;
  /** New bookings and spends waiting for review. */
  found: number;
}

const inFlight = new Map<string, Promise<TripGmailSyncResult | null>>();

/** Reads the trip's unscanned Gmail mail once into proposals for review; null when Gmail isn't connected. */
export function syncTripGmail(trip: Trip): Promise<TripGmailSyncResult | null> {
  const running = inFlight.get(trip.id);
  if (running) return running;
  const task = runSync(trip).finally(() => inFlight.delete(trip.id));
  inFlight.set(trip.id, task);
  return task;
}

const drainTickets = () => drainGmailTickets().catch((error: unknown) => logger.warn("gmail-tickets", "drain failed", error));

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
    await drainTickets();
    return { scanned: false, found: 0 };
  }

  updateTripGmailSyncStatus(trip.id, { state: "syncing", progress: null, errorCode: null });
  logger.debug("gmail-sync", "start", { full: !previous, window_days: Math.round((window.before - window.after) / 86_400_000) });
  try {
    const context = spendContextFor(trip);
    const query = buildTripGmailQuery(trip, window.after, window.before, { domestic: context.domestic });
    const fetched = query
      ? await withGmailAccess((accessToken) =>
          fetchTransactionEmails(accessToken, query, (progress) => updateTripGmailSyncStatus(trip.id, { progress })),
        )
      : [];
    // Oldest first, so updates and cancellations are applied after the booking they change.
    const messages = [...fetched].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    // A first scan or a newer parser re-reads the whole trip.
    const reparse = !previous || previous.parserVersion !== GMAIL_PARSER_VERSION;
    dropOrphanProposals();
    const returnedEvents = reparse ? returnEventsToReview(trip, messages) : 0;
    const cancelledIds = cancelledConfirmationIds(messages);
    const bookings = await proposeBookings(messages, trip);
    const spends = await proposeSpends(
      messages.filter((message) => !message.externalId || !cancelledIds.includes(message.externalId)),
      trip,
      context,
      bookings.messageIds,
      reparse,
    );
    const expensesRemoved = removeCancelledSpends([...bookings.removedSourceIds, ...cancelledIds], trip.id);
    if (reparse || bookings.removedSourceIds.length > 0) await pruneTickets();
    await drainTickets();

    // A trip deleted mid-sync must not leave coverage or proposals behind.
    if (useTripsStore.getState().trips.some((item) => item.id === trip.id)) {
      setTripGmailCoverage(trip.id, coverageAfterScan(trip, account, window, previous));
    } else {
      useGmailInboxStore.getState().removeTrip(trip.id);
    }
    updateTripGmailSyncStatus(trip.id, { state: "done", progress: null });
    const found = bookings.added + spends.added;
    logger.info("gmail-sync", "done", {
      incremental: Boolean(previous && window.after > previous.from),
      window_days: Math.round((window.before - window.after) / 86_400_000),
      messages: messages.length,
      bookings_found: bookings.added,
      spends_found: spends.added,
      returned: returnedEvents + spends.returned,
      expenses_removed: expensesRemoved,
    });
    if (found > 0) track("gmail_found", { bookings: bookings.added, spends: spends.added, returned: returnedEvents + spends.returned });
    return { scanned: true, found };
  } catch (error) {
    updateTripGmailSyncStatus(trip.id, { state: "failed", progress: null, errorCode: importErrorCode(error) });
    logger.warn("gmail-sync", "failed", error);
    throw error;
  }
}

/** Destination currencies and whether the trip is at home, from where its destinations are. */
function spendContextFor(trip: Trip): TripSpendContext {
  const countries = getDestinationCoordinates(trip)
    .map((point) => (point ? placeCountry(point) : null))
    .filter((country): country is string => Boolean(country));
  return tripSpendContext(countries, homeCountryCode(), (country) => countryFacts(country)?.currency);
}

function dropOrphanProposals() {
  const tripIds = new Set(useTripsStore.getState().trips.map((trip) => trip.id));
  const orphans = useGmailInboxStore.getState().proposals.filter((proposal) => !tripIds.has(proposal.tripId));
  useGmailInboxStore.getState().removeProposals(orphans.map((proposal) => proposal.id));
}

/** One-time move of older auto-imported bookings back into review; their emails are proposed again below. */
function returnEventsToReview(trip: Trip, messages: RawMessage[]): number {
  const messageIds = new Set(messages.map((message) => message.externalId).filter((id): id is string => Boolean(id)));
  const ticketEventIds = new Set(useTicketsStore.getState().tickets.map((ticket) => ticket.eventId));
  const returnable = selectReturnableEvents(useEventsStore.getState().events, {
    tripId: trip.id,
    shared: Boolean(trip.shared),
    messageIds,
    ticketEventIds,
  });
  useEventsStore.getState().deleteEvents(returnable.map((event) => event.id));
  return returnable.length;
}

const filesOf = (message: RawMessage | undefined): GmailFileRef[] =>
  message?.externalId
    ? (message.attachments ?? []).map((file) => ({ messageId: message.externalId as string, attachmentId: file.attachmentId, name: file.name, size: file.size }))
    : [];

const uniqueFiles = (files: GmailFileRef[]) => [...new Map(files.map((file) => [`${file.messageId}:${file.name}`, file])).values()];

/**
 * Turns booking emails into proposals. A booking already in the itinerary (or already proposed) takes
 * the email as another source instead, so its PDFs attach; cancellations remove both.
 */
async function proposeBookings(messages: RawMessage[], trip: Trip) {
  const candidates = await buildEventCandidates(messages, "email", { trip });
  const byMessage = new Map(messages.map((message) => [message.externalId, message]));
  const dismissed = useGmailInboxStore.getState().dismissed[trip.id] ?? { ids: [], bookings: [] };
  let proposals: GmailProposal[] = [...useGmailInboxStore.getState().proposals];
  const removedSourceIds: string[] = [];
  const messageIds = new Set<string>();
  let added = 0;

  for (const candidate of candidates) {
    const messageId = candidate.externalId?.replace(/#\d+$/, "");
    if (messageId) messageIds.add(messageId);
    const message = messageId ? byMessage.get(messageId) : undefined;
    const files = filesOf(message);
    const input: CreateEventInput = {
      tripId: trip.id,
      type: candidate.type,
      title: candidate.title,
      detail: candidate.detail,
      transitMode: candidate.transitMode,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      // Flight tickets are per person: on a trip with others, a flight from your inbox is yours.
      people: trip.companions.length > 0 && transitModeOf(candidate) === "flight" ? [SELF_ID] : undefined,
      source: "email",
      rawText: trimStoredEmailText(message?.note ?? candidate.rawText ?? ""),
      externalId: candidate.externalId,
      bookingRef: candidate.bookingRef,
      travel: candidate.travel,
    };

    if (candidate.cancelled) {
      removedSourceIds.push(...useEventsStore.getState().mergeEmailEvents([{ ...input, cancelled: true }]).removedSourceIds);
      const gone = proposals.filter((item) => item.kind === "booking" && item.tripId === trip.id && sameBooking(item.event, input));
      for (const item of gone) if (item.kind === "booking") removedSourceIds.push(item.id, ...(item.event.sourceIds ?? []));
      proposals = proposals.filter((item) => !gone.includes(item));
      continue;
    }

    const tripEvents = useEventsStore.getState().events.filter((event) => event.tripId === trip.id);
    const confirmed =
      tripEvents.find((event) => sameBooking(event, input)) ??
      (messageId ? tripEvents.find((event) => event.source === "email" && eventMessageIds(event).includes(messageId)) : undefined);
    if (confirmed) {
      absorbIntoEvent(confirmed, input);
      if (files.length > 0) queueGmailTickets(confirmed.id, files);
      continue;
    }

    const bookingIndexes = proposals.flatMap((item, index) => (item.kind === "booking" && item.tripId === trip.id ? [index] : []));
    const match = bookingIndexes[findSameBooking(bookingIndexes.map((index) => (proposals[index] as Extract<GmailProposal, { kind: "booking" }>).event), input)];
    if (match !== undefined) {
      const proposal = proposals[match] as Extract<GmailProposal, { kind: "booking" }>;
      const travel = mergeTravelDetails(proposal.event.travel, input.travel);
      proposals[match] = {
        ...proposal,
        event: { ...proposal.event, ...mergeBooking(proposal.event, input), ...(travel ? { travel } : null) },
        files: uniqueFiles([...proposal.files, ...files]),
      };
      continue;
    }
    if (isDismissedBooking(dismissed, input) || !input.externalId) continue;

    proposals.push({
      kind: "booking",
      id: input.externalId,
      tripId: trip.id,
      event: input,
      emailText: input.rawText ?? "",
      files: uniqueFiles(files),
      createdAt: new Date().toISOString(),
    });
    added += 1;
  }

  useGmailInboxStore.getState().setProposals(() => proposals);
  return { added, removedSourceIds, messageIds };
}

/** Records another email about a booking in the itinerary; untouched items also take its new details. */
function absorbIntoEvent(event: TripEvent, input: CreateEventInput) {
  if (!input.externalId || eventMessageIds(event).includes(input.externalId.replace(/#\d+$/, ""))) return;
  const update = event.editedAt
    ? { sourceIds: [...new Set([...(event.sourceIds ?? []), input.externalId])] }
    : (() => {
        const travel = mergeTravelDetails(event.travel, input.travel);
        return { ...mergeBooking(event, input), ...(travel ? { travel } : null) };
      })();
  useEventsStore.getState().updateEvent(event.id, update);
}

/** "From Agoda · 3 Oct", plus a pending-payment mark for booking totals. */
function sourceNote(candidate: ImportCandidate): string {
  const name = emailSenderName(candidate.sender) || candidate.merchant;
  let day = candidate.date.slice(0, 10);
  try {
    day = new Intl.DateTimeFormat(getCurrentLocale(), { day: "numeric", month: "short" }).format(new Date(candidate.date));
  } catch {}
  const line = translate("expenses.gmailSourceNote", { name, date: day });
  return candidate.committedBooking ? `${line} · ${translate("expenses.gmailPaymentPending")}` : line;
}

/**
 * Turns spend emails into proposals with a default split. On the re-read, older auto-imported spends
 * the user never changed go back to review (not on shared trips, where removing one syncs to everyone).
 */
async function proposeSpends(messages: RawMessage[], trip: Trip, context: TripSpendContext, bookingMessageIds: Set<string>, reparse: boolean) {
  const candidates = await buildImportCandidates(messages, "email", { allowModel: false, trip, spendContext: context });
  const byMessage = new Map(messages.map((message) => [message.externalId, message]));
  const expenses = useExpensesStore.getState().expenses;
  const pockets = usePocketsStore.getState().pockets;
  const dismissed = new Set(useGmailInboxStore.getState().dismissed[trip.id]?.ids ?? []);
  let proposals: GmailProposal[] = [...useGmailInboxStore.getState().proposals];
  const selfName = useAuthStore.getState().user?.name;
  const returned: string[] = [];
  let added = 0;

  for (const candidate of candidates) {
    const externalId = candidate.externalId;
    if (!externalId) continue;
    const message = byMessage.get(externalId);
    const emailText = trimStoredEmailText(message?.note ?? candidate.rawText);
    if (candidate.duplicate) {
      const existing = reparse && !trip.shared ? expenses.find((expense) => expense.externalId === externalId) : undefined;
      if (
        !existing ||
        existing.groupId !== trip.id ||
        pocketOfExpense(pockets, existing.id) ||
        !isUntouchedImportedExpense(existing, candidate, emailText)
      ) {
        continue;
      }
      returned.push(existing.id);
    }
    if (dismissed.has(externalId) || proposals.some((proposal) => proposal.id === externalId)) continue;
    const tripSpends = proposals.flatMap((proposal) => (proposal.kind === "spend" && proposal.tripId === trip.id ? [proposal.expense] : []));
    const ledger = expenses.filter((expense) => expense.groupId === trip.id && !returned.includes(expense.id));
    if (isRepeatSpend({ ...candidate, externalId: undefined }, [...ledger, ...tripSpends])) continue;
    if (!isGenericTitle(candidate.merchant)) {
      const key = spendKey(candidate);
      proposals = proposals.filter(
        (proposal) => !(proposal.kind === "spend" && proposal.tripId === trip.id && isGenericTitle(proposal.expense.merchant) && spendKey(proposal.expense) === key),
      );
    }

    const booking = isBookingSpend(candidate.category, {
      committedBooking: candidate.committedBooking,
      hasBooking: bookingMessageIds.has(externalId),
    });
    const split = defaultSpendSplit({
      text: message?.body ?? emailText,
      amount: candidate.amount,
      currency: candidate.currency,
      booking,
      companions: trip.companions,
      selfName,
    });
    proposals.push({
      kind: "spend",
      id: externalId,
      tripId: trip.id,
      booking,
      createdAt: new Date().toISOString(),
      expense: {
        groupId: trip.id,
        merchant: candidate.merchant || translate("expenses.unknownMerchant"),
        amount: candidate.amount,
        currency: candidate.currency,
        category: candidate.category,
        date: candidate.date,
        source: "email",
        autoCategorized: true,
        rawText: emailText,
        note: sourceNote(candidate),
        externalId,
        location: null,
        ...split,
      },
    });
    added += 1;
  }

  useExpensesStore.getState().removeExpenses(returned);
  useGmailInboxStore.getState().setProposals(() => proposals);
  return { added, returned: returned.length };
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

/** Drops the spends (added or proposed) from the confirmation of a booking that was later cancelled. */
function removeCancelledSpends(sourceIds: string[], tripId: string): number {
  // Event source ids are "gmail:<message>#<n>"; the spend from that email is "gmail:<message>".
  const messageIds = new Set(sourceIds.map((id) => id.replace(/#\d+$/, "")));
  if (messageIds.size === 0) return 0;
  useGmailInboxStore
    .getState()
    .removeProposals(
      useGmailInboxStore
        .getState()
        .proposals.filter((proposal) => proposal.kind === "spend" && proposal.tripId === tripId && messageIds.has(proposal.id))
        .map((proposal) => proposal.id),
    );
  const { expenses, removeExpenses } = useExpensesStore.getState();
  const cancelled = expenses.filter(
    (expense) => expense.groupId === tripId && expense.source === "email" && expense.externalId && messageIds.has(expense.externalId),
  );
  removeExpenses(cancelled.map((expense) => expense.id));
  return cancelled.length;
}
