import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import type { EventType } from "@/features/itinerary/constants/eventTypes";

export type EventSource = "manual" | "email";

export interface TripEvent {
  id: string;
  tripId: string | null;
  type: EventType;
  title: string;
  /** Secondary line, e.g. "Hoi An → Hue" or "SE2 sleeper · car 4". */
  detail?: string;
  /** ISO datetime the event starts. */
  startAt: string;
  endAt?: string;
  source: EventSource;
  note?: string;
  rawText?: string;
  /** Stable id of the originating message (e.g. `gmail:<messageId>`) for dedupe. */
  externalId?: string;
  createdAt: string;
}

export interface CreateEventInput {
  tripId: string | null;
  type: EventType;
  title: string;
  detail?: string;
  startAt: string;
  endAt?: string;
  source: EventSource;
  note?: string;
  rawText?: string;
  externalId?: string;
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
  hasFingerprint: (fingerprint: string) => boolean;
  hasExternalId: (externalId: string) => boolean;
  reset: () => void;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
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
      hasFingerprint: (fingerprint) =>
        get().events.some(
          (event) =>
            eventFingerprint({
              type: event.type,
              title: event.title,
              detail: event.detail,
              startAt: event.startAt,
            }) === fingerprint,
        ),
      hasExternalId: (externalId) =>
        get().events.some((event) => event.externalId === externalId),
      reset: () => set({ events: [] }),
    }),
    {
      name: "itinerary-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
    },
  ),
);
