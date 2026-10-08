import React, { useState } from "react";
import { useRouter } from "expo-router";
import { showAlert, showToast } from "@/atoms";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { api, useMutation, type Id } from "@/modules/backend";
import { logger } from "@/modules/logger";
import { showInterstitial } from "@/modules/ads";
import { SELF_ID } from "@/features/expenses/utils/split";
import type { Trip } from "@/features/trips/store/tripsStore";
import { fromDateKey } from "@/features/trips/utils/dates";
import { EventForm, type EventFormValues } from "@/features/itinerary/components/EventForm";
import { readTicketScreenshot, type ScreenshotRead } from "@/features/itinerary/services/ticketScreenshot";
import { attachImage, removeTickets } from "@/features/itinerary/services/tickets";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { usePlaceLookupStore } from "@/features/itinerary/store/placeLookupStore";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";

/** Where a new event starts: the next full hour on today, 09:00 on another day, now without a day. */
export function defaultStartFor(day: Date | null | undefined, now: number): Date | undefined {
  if (!day) return undefined;
  const current = new Date(now);
  if (day.toDateString() === current.toDateString()) {
    return new Date(current.getFullYear(), current.getMonth(), current.getDate(), current.getHours() + 1);
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
}

/**
 * Adding and editing a trip's items: the item form (render `form`), ticking items off, opening
 * tickets and asking someone on a shared trip for theirs.
 */
export function useItineraryEditor(trip: Trip) {
  const { t } = useLocalization();
  const router = useRouter();
  const addEvent = useEventsStore((state) => state.addEvent);
  const updateEvent = useEventsStore((state) => state.updateEvent);
  const deleteEvent = useEventsStore((state) => state.deleteEvent);
  const tickets = useTicketsStore((state) => state.tickets);
  const askMutation = useMutation(api.groups.askForTicket);
  // `null` = closed; "new" = add form; otherwise the event being edited.
  const [editing, setEditing] = useState<TripEvent | "new" | null>(null);
  const [defaultStart, setDefaultStart] = useState<Date | undefined>(undefined);
  const [prefill, setPrefill] = useState<ScreenshotRead | null>(null);

  const openTickets = (eventId: string, ticketId?: string) => router.push({ pathname: "/ticket/[eventId]", params: { eventId, ...(ticketId ? { ticketId } : null) } });

  const askForTicket = (event: TripEvent) => {
    const serverTripId = trip.shared?.groupId;
    if (!serverTripId) return;
    const names = (event.ticketHolders ?? []).filter((person) => person !== SELF_ID).join(", ");
    showAlert(t("tickets.askTitle", { names }), t("tickets.askBody", { names }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("tickets.ask"),
        onPress: () => {
          track("today_action", { action: "ask_ticket" });
          askMutation({ groupId: serverTripId as Id<"sharedGroups">, clientId: event.id })
            .then(({ sent }) => showToast(sent ? t("tickets.asked", { names }) : t("tickets.askedRecently")))
            .catch((error: unknown) => {
              logger.warn("tickets", "ask failed", error);
              showToast(t("tickets.askFailed"));
            });
        },
      },
    ]);
  };

  const toggleDone = (event: TripEvent) => {
    track("today_action", { action: event.doneAt ? "undone" : "done" });
    updateEvent(event.id, { doneAt: event.doneAt ? undefined : new Date().toISOString() });
  };

  const handleSave = (values: EventFormValues) => {
    const fields = {
      type: values.type,
      title: values.title,
      detail: values.detail || undefined,
      transitMode: values.transitMode,
      startAt: values.startAt,
      endAt: values.endAt,
      timing: values.timing,
      people: values.people,
      where: values.where,
      link: values.link,
      travel: values.travel,
      bookingRef: values.bookingRef,
    };
    if (editing && editing !== "new") {
      // A place found from the old name or "where" is looked up again; one saved with an idea stays.
      const looked = usePlaceLookupStore.getState().tried[editing.id];
      const renamed = (values.where ?? values.title) !== (editing.where ?? editing.title);
      const replace = renamed && (Boolean(looked) || values.where !== editing.where);
      updateEvent(editing.id, { ...fields, ...(replace ? { place: undefined } : null), editedAt: new Date().toISOString() });
      track("itinerary_event_edited", { source: editing.source });
    } else {
      const created = addEvent({ tripId: trip.id, ...fields, source: "manual" });
      if (values.screenshot) {
        void attachImage(created.id, values.screenshot.uri, values.screenshot.name).then((kept) => {
          if (kept) track("ticket_added", { source: "screenshot", count: 1 });
        });
      }
      track("itinerary_event_added", { source: values.screenshot ? "screenshot" : "manual", count: 1 });
    }
    setEditing(null);
    if (editing === "new") showInterstitial("itinerary_event_added");
  };

  const form =
    editing !== null ? (
      <EventForm
        key={editing === "new" ? "new" : editing.id}
        event={editing === "new" ? null : editing}
        defaultStart={editing === "new" ? defaultStart : undefined}
        tripStart={fromDateKey(trip.startDate)}
        companions={trip.companions}
        sharedTrip={Boolean(trip.shared)}
        readScreenshot={() => readTicketScreenshot(trip)}
        prefill={editing === "new" ? prefill : null}
        onAskForTicket={() => {
          if (editing === "new") return;
          const event = editing;
          setEditing(null);
          askForTicket(event);
        }}
        onOpenTicket={(ticketId) => {
          if (editing === "new") return;
          const eventId = editing.id;
          setEditing(null);
          openTickets(eventId, ticketId);
        }}
        visible
        onSave={handleSave}
        onDelete={
          editing !== "new"
            ? () => {
                deleteEvent(editing.id);
                void removeTickets(tickets.filter((ticket) => ticket.eventId === editing.id));
                track("itinerary_event_deleted", { source: editing.source });
                setEditing(null);
              }
            : undefined
        }
        onClose={() => setEditing(null)}
      />
    ) : null;

  return {
    form,
    edit: (event: TripEvent) => setEditing(event),
    add: async (start?: Date, options?: { screenshot?: boolean }) => {
      let read: ScreenshotRead | null = null;
      if (options?.screenshot) {
        read = await readTicketScreenshot(trip);
        if (!read) return;
        track("ticket_screenshot_read", { found: Boolean(read.booking) });
        showToast(read.booking ? t("itinerary.form.screenshotFilled") : t("itinerary.form.screenshotNothing"));
      }
      setDefaultStart(start);
      setPrefill(read);
      setEditing("new");
    },
    toggleDone,
    openTickets,
    askForTicket: trip.shared ? askForTicket : undefined,
  };
}
