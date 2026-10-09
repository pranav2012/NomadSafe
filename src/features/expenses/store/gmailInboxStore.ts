import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { CreateExpenseInput } from "@/features/expenses/store/expensesStore";
import type { CreateEventInput } from "@/features/itinerary/store/eventsStore";
import type { BookingLike } from "@/features/itinerary/utils/bookings";

export interface GmailFileRef {
  messageId: string;
  attachmentId: string;
  name: string;
  size: number;
}

export interface SpendProposal {
  kind: "spend";
  id: string;
  tripId: string;
  /** Ready to add: source "email", a short source line as the note and the email text as `rawText`. */
  expense: CreateExpenseInput;
  booking: boolean;
  createdAt: string;
}

export interface BookingProposal {
  kind: "booking";
  /** `externalId` of the first email ("gmail:<id>#<n>"). */
  id: string;
  tripId: string;
  event: CreateEventInput;
  emailText: string;
  /** PDFs from every email about this booking, saved as tickets once it's confirmed. */
  files: GmailFileRef[];
  createdAt: string;
}

export type GmailProposal = SpendProposal | BookingProposal;

/** A PDF still to download onto a confirmed item; kept until it's saved, so failures retry on the next sync. */
export interface PendingTicket extends GmailFileRef {
  eventId: string;
  tries: number;
}

export interface DismissedGmail {
  ids: string[];
  bookings: BookingLike[];
}

interface GmailInboxState {
  proposals: GmailProposal[];
  dismissed: Record<string, DismissedGmail>;
  pendingTickets: PendingTicket[];
  setProposals: (update: (proposals: GmailProposal[]) => GmailProposal[]) => void;
  removeProposals: (ids: string[]) => void;
  dismiss: (proposals: GmailProposal[]) => void;
  queueTickets: (tickets: Omit<PendingTicket, "tries">[]) => void;
  setPendingTickets: (tickets: PendingTicket[]) => void;
  removeTrip: (tripId: string) => void;
  reset: () => void;
}

const MAX_DISMISSED = 400;

const ticketKey = (ticket: Pick<PendingTicket, "eventId" | "messageId" | "name">) => `${ticket.eventId}|${ticket.messageId}|${ticket.name}`;

/** Gmail finds waiting for review, per trip, and what was dismissed; kept on this phone only (never backed up or shared). */
export const useGmailInboxStore = create<GmailInboxState>()(
  persist(
    (set) => ({
      proposals: [],
      dismissed: {},
      pendingTickets: [],
      setProposals: (update) => set((state) => ({ proposals: update(state.proposals) })),
      removeProposals: (ids) => {
        if (ids.length === 0) return;
        const remove = new Set(ids);
        set((state) => ({ proposals: state.proposals.filter((proposal) => !remove.has(proposal.id)) }));
      },
      dismiss: (proposals) =>
        set((state) => {
          const dismissed = { ...state.dismissed };
          for (const proposal of proposals) {
            const current = dismissed[proposal.tripId] ?? { ids: [], bookings: [] };
            const ids =
              proposal.kind === "spend"
                ? [proposal.id]
                : [proposal.id, ...(proposal.event.sourceIds ?? [])];
            dismissed[proposal.tripId] = {
              ids: [...new Set([...current.ids, ...ids])].slice(-MAX_DISMISSED),
              bookings:
                proposal.kind === "booking"
                  ? [...current.bookings, bookingShape(proposal.event)].slice(-MAX_DISMISSED)
                  : current.bookings,
            };
          }
          const remove = new Set(proposals.map((proposal) => proposal.id));
          return { dismissed, proposals: state.proposals.filter((proposal) => !remove.has(proposal.id)) };
        }),
      queueTickets: (tickets) =>
        set((state) => {
          const known = new Set(state.pendingTickets.map(ticketKey));
          const added = tickets.filter((ticket) => !known.has(ticketKey(ticket))).map((ticket) => ({ ...ticket, tries: 0 }));
          return added.length > 0 ? { pendingTickets: [...state.pendingTickets, ...added] } : state;
        }),
      setPendingTickets: (pendingTickets) => set({ pendingTickets }),
      removeTrip: (tripId) =>
        set((state) => {
          const { [tripId]: _removed, ...dismissed } = state.dismissed;
          return { dismissed, proposals: state.proposals.filter((proposal) => proposal.tripId !== tripId) };
        }),
      reset: () => set({ proposals: [], dismissed: {}, pendingTickets: [] }),
    }),
    { name: "gmail-inbox-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);

function bookingShape(event: CreateEventInput): BookingLike {
  return {
    type: event.type,
    title: event.title,
    detail: event.detail,
    startAt: event.startAt,
    endAt: event.endAt,
    bookingRef: event.bookingRef,
    transitMode: event.transitMode,
  };
}

/** Which trip's Gmail review sheet is open (one sheet, mounted in the root layout). */
export const useGmailReviewSheet = create<{ tripId: string | null; open: (tripId: string) => void; close: () => void }>((set) => ({
  tripId: null,
  open: (tripId) => set({ tripId }),
  close: () => set({ tripId: null }),
}));
