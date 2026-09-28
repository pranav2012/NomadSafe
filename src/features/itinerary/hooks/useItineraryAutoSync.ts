import { useEffect, useRef, useState } from "react";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { buildEventCandidates } from "@/features/itinerary/services/itineraryExtraction";
import {
  loadItineraryLastSyncAt,
  saveItineraryLastSyncAt,
} from "@/features/itinerary/services/itinerarySyncStore";
import type { Trip } from "@/features/trips/store/tripsStore";

// Each trip syncs at most once per app session.
const sessionSyncedTripIds = new Set<string>();

export interface ItineraryAutoSync {
  importedCount: number | null;
  dismiss: () => void;
}

/**
 * On launch, if Gmail is connected, silently fetches recent booking emails and
 * adds any new (non-duplicate) itinerary events to the active trip. Parsing is
 * fully offline (regex date extraction); no on-device model is used.
 */
export function useItineraryAutoSync(trip: Trip | null): ItineraryAutoSync {
  const gmail = useGmailImport();
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const tripRef = useRef(trip);
  const fetchRef = useRef(gmail.fetchEmailsSince);
  const tripId = trip?.id ?? null;

  // Declared before the sync effect so it sees the latest values when it runs.
  useEffect(() => {
    tripRef.current = trip;
    fetchRef.current = gmail.fetchEmailsSince;
  });

  useEffect(() => {
    const current = tripRef.current;
    if (!tripId || !current || sessionSyncedTripIds.has(tripId) || !gmail.connected) {
      if (__DEV__) {
        console.info("[itinerary-sync] skip", {
          hasTrip: Boolean(tripId),
          synced: tripId ? sessionSyncedTripIds.has(tripId) : false,
          connected: gmail.connected,
        });
      }
      return;
    }
    sessionSyncedTripIds.add(tripId);

    let active = true;
    (async () => {
      try {
        // While the itinerary is still empty, ignore the checkpoint and scan the
        // full window so existing bookings get picked up; once populated, sync
        // incrementally so we don't re-download the mailbox each launch.
        const hasEvents = useEventsStore
          .getState()
          .events.some((event) => event.tripId === tripId);
        const since = hasEvents ? await loadItineraryLastSyncAt(tripId) : null;
        const { messages, fetchedAt } = await fetchRef.current(since, { trip: current });
        if (__DEV__) console.info("[itinerary-sync] fetched", { since, messages: messages.length });
        const candidates = await buildEventCandidates(messages, "email", { trip: current });

        const fresh = candidates.filter((candidate) => !candidate.duplicate);
        if (__DEV__) console.info("[itinerary-sync] adding", { fresh: fresh.length });
        // Events belong to `tripId`, so they're stored even if the user switched trips meanwhile.
        if (fresh.length > 0) {
          useEventsStore.getState().addEvents(
            fresh.map((candidate) => ({
              tripId,
              type: candidate.type,
              title: candidate.title,
              detail: candidate.detail,
              startAt: candidate.startAt,
              source: candidate.source,
              note: candidate.note,
              rawText: candidate.rawText,
              externalId: candidate.externalId,
            })),
          );
          if (active) setImportedCount(fresh.length);
        }
        await saveItineraryLastSyncAt(tripId, fetchedAt);
      } catch (err) {
        sessionSyncedTripIds.delete(tripId);
        console.warn("[itinerary-sync] failed", err);
      }
    })();

    return () => {
      active = false;
    };
  }, [gmail.connected, tripId]);

  return { importedCount, dismiss: () => setImportedCount(null) };
}
