import { translate } from "@/localization/translate";
import { logger } from "@/modules/logger";
import { notifications } from "@/modules/notifications";
import { storage } from "@/modules/storage";
import { isArchivedGroup, type Trip } from "@/features/trips/store/tripsStore";
import { addDays, fromDateKey } from "@/features/trips/utils/dates";
import { isRecapFinished } from "../store/recapStore";

export const RECAP_NOTIFICATION_SOURCE = "nomadsafe-trip-recap";
const CHANNEL_ID = "trip-recap";
const SCHEDULED_KEY = "trip-recap.scheduled";
const DELIVERY_HOUR = 10;

const idFor = (tripId: string) => `trip-recap-${tripId}`;

/** 10:00 local on the day after the trip ends. */
export function recapNotificationTime(trip: Pick<Trip, "endDate">): number {
  const day = addDays(fromDateKey(trip.endDate), 1);
  day.setHours(DELIVERY_HOUR, 0, 0, 0);
  return day.getTime();
}

function readScheduled(): Record<string, number> {
  try {
    return JSON.parse(storage.getString(SCHEDULED_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Keeps one "your trip is wrapped" notification per future trip end, moving or cancelling it when
 * trips change. Never prompts: it only schedules when notifications are already allowed.
 */
export async function syncRecapNotifications(trips: Trip[], finished: Record<string, string>, now = Date.now()) {
  try {
    const { granted } = await notifications.getPermission();
    const wanted = new Map<string, { trip: Trip; at: number }>();
    if (granted) {
      for (const trip of trips) {
        const at = recapNotificationTime(trip);
        if (at > now && !isRecapFinished(trip, finished) && !isArchivedGroup(trip)) wanted.set(trip.id, { trip, at });
      }
    }

    const scheduled = readScheduled();
    for (const tripId of Object.keys(scheduled)) {
      if (wanted.get(tripId)?.at === scheduled[tripId]) continue;
      await notifications.cancel(idFor(tripId)).catch(() => {});
      delete scheduled[tripId];
    }
    if (wanted.size > 0) {
      await notifications.setChannel(CHANNEL_ID, { name: translate("recap.channelName"), importance: "default" });
    }
    for (const [tripId, { trip, at }] of wanted) {
      if (scheduled[tripId] === at) continue;
      await notifications.schedule({
        id: idFor(tripId),
        title: translate("recap.notifyTitle", { name: trip.name }),
        body: translate("recap.notifyBody"),
        data: { source: RECAP_NOTIFICATION_SOURCE, tripId },
        at,
        channelId: CHANNEL_ID,
      });
      scheduled[tripId] = at;
    }
    storage.set(SCHEDULED_KEY, JSON.stringify(scheduled));
  } catch (err) {
    logger.warn("trip-recap", "notification sync failed", err);
  }
}
