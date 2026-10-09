import { drainGmailTickets, queueGmailTickets } from "@/features/expenses/services/gmailTickets";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import {
  useGmailInboxStore,
  type BookingProposal,
  type GmailProposal,
  type SpendProposal,
} from "@/features/expenses/store/gmailInboxStore";
import { eventMessageIds } from "@/features/expenses/utils/gmailReview";
import { useEventsStore, type CreateEventInput } from "@/features/itinerary/store/eventsStore";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";

type ReviewAction = "confirm" | "edit" | "dismiss" | "confirm_all";

function trackReview(action: ReviewAction, proposals: GmailProposal[]) {
  if (proposals.length === 0) return;
  const kinds = new Set(proposals.map((proposal) => proposal.kind));
  track("gmail_review", { action, kind: kinds.size > 1 ? "mixed" : proposals[0].kind, count: proposals.length });
}

function addSpends(proposals: SpendProposal[]): number {
  const added = useExpensesStore.getState().addExpenses(proposals.map((proposal) => proposal.expense));
  if (added.length > 0) track("expense_added", { source: "gmail", count: added.length });
  return added.length;
}

/** Adds a booking (merged into the same booking if one was added meanwhile) and queues its PDFs; returns its item id. */
function addBooking(proposal: BookingProposal, edited?: CreateEventInput): string | null {
  const events = useEventsStore.getState();
  let eventId: string | null;
  if (edited) {
    const created = events.addEvent(edited);
    events.updateEvent(created.id, { editedAt: new Date().toISOString() });
    eventId = created.id;
  } else {
    events.mergeEmailEvents([proposal.event]);
    eventId =
      useEventsStore
        .getState()
        .events.find((event) => event.tripId === proposal.tripId && eventMessageIds(event).includes(proposal.id.replace(/#\d+$/, "")))?.id ?? null;
  }
  if (eventId && proposal.files.length > 0) queueGmailTickets(eventId, proposal.files);
  return eventId;
}

function afterBookings(count: number) {
  if (count === 0) return;
  track("itinerary_event_added", { source: "gmail", count });
  drainGmailTickets().catch((error: unknown) => logger.warn("gmail-tickets", "drain failed", error));
}

/** Moves one proposal into the trip's spends or itinerary as it was found. */
export function confirmProposal(proposal: GmailProposal): void {
  useGmailInboxStore.getState().removeProposals([proposal.id]);
  if (proposal.kind === "spend") addSpends([proposal]);
  else afterBookings(addBooking(proposal) ? 1 : 0);
  trackReview("confirm", [proposal]);
}

/** Confirms a booking with the user's changes from the item form. */
export function confirmEditedBooking(proposal: BookingProposal, edited: CreateEventInput): void {
  useGmailInboxStore.getState().removeProposals([proposal.id]);
  afterBookings(addBooking(proposal, edited) ? 1 : 0);
  trackReview("edit", [proposal]);
}

/** The spend form already saved the edited spend; the proposal is done. */
export function finishEditedSpend(proposal: SpendProposal): void {
  useGmailInboxStore.getState().removeProposals([proposal.id]);
  trackReview("edit", [proposal]);
}

/** Confirms every proposal of a trip; returns how many were added. */
export function confirmAllProposals(tripId: string): number {
  const proposals = useGmailInboxStore.getState().proposals.filter((proposal) => proposal.tripId === tripId);
  if (proposals.length === 0) return 0;
  useGmailInboxStore.getState().removeProposals(proposals.map((proposal) => proposal.id));
  const spends = addSpends(proposals.filter((proposal): proposal is SpendProposal => proposal.kind === "spend"));
  let bookings = 0;
  for (const proposal of proposals) if (proposal.kind === "booking" && addBooking(proposal)) bookings += 1;
  afterBookings(bookings);
  trackReview("confirm_all", proposals);
  return spends + bookings;
}

/** Drops proposals for good: the same emails or bookings are never proposed again. */
export function dismissProposals(proposals: GmailProposal[]): void {
  useGmailInboxStore.getState().dismiss(proposals);
  trackReview("dismiss", proposals);
}
