import { useEffect, useState } from "react";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { buildEventCandidates } from "@/features/itinerary/services/itineraryExtraction";
import {
  loadItineraryLastSyncAt,
  saveItineraryLastSyncAt,
} from "@/features/itinerary/services/itinerarySyncStore";
import type { Trip } from "@/features/trips/store/tripsStore";

// Runs once per app session for the trip that is active when Gmail becomes available.
let sessionSynced = false;

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
  const addEvents = useEventsStore((state) => state.addEvents);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!trip || sessionSynced || !gmail.connected) {
      console.info("[itinerary-sync] skip", {
        hasTrip: Boolean(trip),
        sessionSynced,
        connected: gmail.connected,
      });
      return;
    }
    sessionSynced = true;

    let mounted = true;
    (async () => {
      try {
        // While the itinerary is still empty, ignore the checkpoint and scan the
        // full window so existing bookings get picked up; once populated, sync
        // incrementally so we don't re-download the mailbox each launch.
        const hasEvents = useEventsStore
          .getState()
          .events.some((event) => event.tripId === trip.id);
        const since = hasEvents ? await loadItineraryLastSyncAt() : null;
        const messages = await gmail.fetchEmailsSince(since);
        console.info("[itinerary-sync] fetched", { since, messages: messages.length });
        const candidates = await buildEventCandidates(messages, "email", { trip });
        await saveItineraryLastSyncAt(Date.now());

        const fresh = candidates.filter((candidate) => !candidate.duplicate);
        console.info("[itinerary-sync] adding", { fresh: fresh.length });
        if (mounted && fresh.length > 0) {
          addEvents(
            fresh.map((candidate) => ({
              tripId: trip.id,
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
          setImportedCount(fresh.length);
        }
      } catch (err) {
        console.warn("[itinerary-sync] failed", err);
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail.connected, trip]);

  return { importedCount, dismiss: () => setImportedCount(null) };
}
