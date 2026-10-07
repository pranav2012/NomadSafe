import { repairEventTripId } from "@/features/itinerary/utils/eventRepair";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { EventTiming, EventType, TransitMode } from "@/features/itinerary/constants/eventTypes";
import { consolidateEmailBookings, mergeBooking, sameBooking } from "@/features/itinerary/utils/bookings";
import { normalizeWallClock } from "@/features/itinerary/utils/wallClock";

export type EventSource = "manual" | "email";

/** Where an idea is, so it can be offered on the day you're near it. */
export interface EventPlace {
  name: string;
  latitude: number;
  longitude: number;
}

/** A reel, video or page saved as an idea. `thumbnail` is a remote preview image when one was found. */
export interface EventLink {
  url: string;
  provider: "instagram" | "tiktok" | "youtube" | "web";
  author?: string;
  thumbnail?: string;
}

export interface TripEvent {
  id: string;
  tripId: string | null;
  type: EventType;
  title: string;
  /** Secondary line, e.g. "Hoi An → Hue" or "SE2 sleeper · car 4". */
  detail?: string;
  /** Transit only; older events have none and are guessed with `transitModeOf`. */
  transitMode?: TransitMode;
  /** Wall-clock time at the place, no zone ("2026-10-18T15:00:00"); see `toWallClock`. Midnight of the day for "anytime"; only orders wishlist items. */
  startAt: string;
  endAt?: string;
  timing?: EventTiming;
  /** Who it's for: SELF_ID and companion names (member ids on the server); empty means everyone. */
  people?: string[];
  /** Ticked off; shared with everyone on the trip. */
  doneAt?: string;
  /** Shared trips: who has a ticket for this item on their phone (labels only; files never sync). */
  ticketHolders?: string[];
  source: EventSource;
  note?: string;
  rawText?: string;
  /** Stable id of the originating message (e.g. `gmail:<messageId>`) for dedupe. */
  externalId?: string;
  /** Ids of other emails about the same booking, merged into this event. */
  sourceIds?: string[];
  /** Confirmation number from the booking email; cancellations and updates match on it. */
  bookingRef?: string;
  /** Saved ideas: who saved it (SELF_ID or a companion name; a member id on the server). */
  savedBy?: string;
  place?: EventPlace;
  link?: EventLink;
  /** Set when the user edits the event, so Gmail re-imports leave it alone. */
  editedAt?: string;
  createdAt: string;
}

export interface CreateEventInput {
  tripId: string | null;
  type: EventType;
  title: string;
  detail?: string;
  transitMode?: TransitMode;
  startAt: string;
  endAt?: string;
  timing?: EventTiming;
  people?: string[];
  source: EventSource;
  note?: string;
  rawText?: string;
  externalId?: string;
  sourceIds?: string[];
  bookingRef?: string;
  savedBy?: string;
  place?: EventPlace;
  link?: EventLink;
}

export interface EmailEventInput extends CreateEventInput {
  /** A cancellation email: removes the matching booking instead of adding one. */
  cancelled?: boolean;
}

export interface EmailMergeResult {
  added: number;
  /** Source ids of Gmail events removed by cancellations, to drop their spends too. */
  removedSourceIds: string[];
}

export type UpdateEventInput = Partial<Omit<TripEvent, "id" | "createdAt">>;

// Lowercase and drop punctuation/spacing so "The Chi Boutique." and
// "the chi boutique" fingerprint identically across slightly different emails.
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Stable fingerprint used to skip importing the same event twice. Includes the
 *  detail so a stay's check-in/check-out (or a flight's departure/arrival) on the
 *  same day stay distinct. */
export function eventFingerprint(input: {
  type: EventType;
  title: string;
  detail?: string;
  startAt: string;
}): string {
  const day = input.startAt.slice(0, 10);
  return `${input.type}|${normalizeKey(input.title)}|${normalizeKey(input.detail ?? "")}|${day}`;
}

interface EventsState {
  events: TripEvent[];
  addEvent: (input: CreateEventInput) => TripEvent;
  addEvents: (inputs: CreateEventInput[]) => TripEvent[];
  updateEvent: (id: string, input: UpdateEventInput) => TripEvent | null;
  deleteEvent: (id: string) => void;
  deleteEvents: (ids: string[]) => void;
  /** Scoped to `tripId` when given, so the same booking can exist in two trips. */
  hasFingerprint: (fingerprint: string, tripId?: string | null) => boolean;
  hasExternalId: (externalId: string, tripId?: string | null) => boolean;
  /** Applies Gmail events in order: merges into the same booking, adds new ones, removes cancelled ones. */
  mergeEmailEvents: (inputs: EmailEventInput[]) => EmailMergeResult;
  /** Drops a trip's Gmail events the user hasn't edited, before a re-import with a newer parser. */
  removeUneditedEmailEvents: (tripId: string) => void;
  removeByTripId: (tripId: string) => void;
  reset: () => void;
}

let idCounter = 0;
// The random part keeps ids unique across phones, since shared trips mix records from several members.
function nextId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEvent(input: CreateEventInput): TripEvent {
  return {
    ...input,
    id: nextId(),
    createdAt: new Date().toISOString(),
  };
}

export const useEventsStore = create<EventsState>()(
  persist(
    (set, get) => ({
      events: [],
      addEvent: (input) => {
        const event = buildEvent(input);
        set((state) => ({ events: [event, ...state.events] }));
        return event;
      },
      addEvents: (inputs) => {
        const created = inputs.map(buildEvent);
        set((state) => ({ events: [...created, ...state.events] }));
        return created;
      },
      updateEvent: (id, input) => {
        let updated: TripEvent | null = null;
        set((state) => ({
          events: state.events.map((event) => {
            if (event.id !== id) return event;
            updated = { ...event, ...input };
            return updated;
          }),
        }));
        return updated;
      },
      deleteEvent: (id) =>
        set((state) => ({
          events: state.events.filter((event) => event.id !== id),
        })),
      deleteEvents: (ids) => {
        const idsToDelete = new Set(ids);
        set((state) => ({
          events: state.events.filter((event) => !idsToDelete.has(event.id)),
        }));
      },
      hasFingerprint: (fingerprint, tripId) =>
        get().events.some(
          (event) =>
            (tripId === undefined || event.tripId === tripId) &&
            eventFingerprint({
              type: event.type,
              title: event.title,
              detail: event.detail,
              startAt: event.startAt,
            }) === fingerprint,
        ),
      hasExternalId: (externalId, tripId) =>
        get().events.some(
          (event) =>
            (tripId === undefined || event.tripId === tripId) &&
            (event.externalId === externalId || Boolean(event.sourceIds?.includes(externalId))),
        ),
      mergeEmailEvents: (inputs) => {
        const result: EmailMergeResult = { added: 0, removedSourceIds: [] };
        set((state) => {
          let events = [...state.events];
          for (const { cancelled, ...input } of inputs) {
            const matches = (event: TripEvent) => event.tripId === input.tripId && sameBooking(event, input);
            if (cancelled) {
              const removed = events.filter((event) => matches(event) && event.source === "email" && !event.editedAt);
              for (const event of removed) {
                result.removedSourceIds.push(...[event.externalId, ...(event.sourceIds ?? [])].filter((id): id is string => Boolean(id)));
              }
              events = events.filter((event) => !removed.includes(event));
              continue;
            }
            const index = events.findIndex(matches);
            if (index >= 0) {
              events[index] = { ...events[index], ...mergeBooking(events[index], input) };
            } else {
              events.unshift(buildEvent(input));
              result.added += 1;
            }
          }
          return { events };
        });
        return result;
      },
      removeUneditedEmailEvents: (tripId) =>
        set((state) => ({
          events: state.events.filter((event) => !(event.tripId === tripId && event.source === "email" && !event.editedAt)),
        })),
      removeByTripId: (tripId) =>
        set((state) => ({
          events: state.events.filter((event) => event.tripId !== tripId),
        })),
      reset: () => set({ events: [] }),
    }),
    {
      name: "itinerary-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 4,
      migrate: (persisted, version) => {
        let state = persisted as { events?: TripEvent[] };
        // v2: one event per booking instead of check-in/check-out pairs and per-email copies.
        if (version < 2 && state.events) state = { ...state, events: consolidateEmailBookings(state.events) };
        // v3: times typed in the form were instants; keep them as the wall-clock time the user picked.
        if (version < 3 && state.events) {
          state = {
            ...state,
            events: state.events.map((event) => ({
              ...event,
              startAt: normalizeWallClock(event.startAt),
              ...(event.endAt ? { endAt: normalizeWallClock(event.endAt) } : null),
            })),
          };
        }
        // v4: events an older sync moved out of their trip (tripId renamed to groupId).
        if (version < 4 && state.events) state = { ...state, events: state.events.map(repairEventTripId) };
        return state;
      },
    },
  ),
);
