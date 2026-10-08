import { translate } from "@/localization/translate";
import { logger } from "@/modules/logger";
import { notifications } from "@/modules/notifications";
import { storage } from "@/modules/storage";
import type { Trip } from "@/features/trips/store/tripsStore";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { travelPlan } from "@/features/itinerary/utils/dayShape";
import { routeOf } from "@/features/itinerary/utils/entryText";
import { isForMe } from "@/features/itinerary/utils/people";
import { transitModeOf } from "@/features/itinerary/utils/transit";

export const TRAVEL_NOTIFICATION_SOURCE = "nomadsafe-travel";
const CHANNEL_ID = "travel";
const SCHEDULED_KEY = "travel-reminders.scheduled";
const HORIZON_MS = 14 * 86_400_000;
const LEAVE_HEADS_UP_MS = 20 * 60_000;
const BOARDING_HEADS_UP_MS = 15 * 60_000;

interface Reminder {
  id: string;
  at: number;
  title: string;
  body: string;
  event: TripEvent;
}

function readScheduled(): Record<string, string> {
  try {
    return JSON.parse(storage.getString(SCHEDULED_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

type ClockFormat = { locale: string; hour12: boolean };

function clock(ms: number, { locale, hour12 }: ClockFormat) {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12 }).format(new Date(ms));
}

/** "Leave by" and "Boarding soon" for your departures in the next two weeks; flights, trains, buses and ferries. */
function remindersFor(events: TripEvent[], trips: Trip[], homeCountry: string | null, hour12: ClockFormat, now: number): Reminder[] {
  const tripIds = new Set(trips.map((trip) => trip.id));
  const reminders: Reminder[] = [];
  for (const event of events) {
    if (event.type !== "transit" || event.timing || event.doneAt || !isForMe(event) || !event.tripId || !tripIds.has(event.tripId)) continue;
    const mode = transitModeOf(event);
    if (!mode || mode === "car") continue;
    const departAt = new Date(event.startAt).getTime();
    if (departAt <= now || departAt - now > HORIZON_MS) continue;
    const plan = travelPlan(
      events.filter((item) => item.tripId === event.tripId),
      event,
      homeCountry,
    );
    const name = [event.title, routeOf(event.detail)].filter(Boolean).join(" · ");
    const leaveNotice = plan.leaveAt - LEAVE_HEADS_UP_MS;
    if (leaveNotice > now) {
      reminders.push({
        id: `travel-leave-${event.id}`,
        at: leaveNotice,
        title: translate("itinerary.reminders.leaveTitle", { time: clock(plan.leaveAt, hour12) }),
        body: translate(mode === "flight" ? "itinerary.reminders.leaveBodyFlight" : "itinerary.reminders.leaveBody", { name, time: clock(departAt, hour12) }),
        event,
      });
    }
    if (plan.boardingAt !== null && plan.boardingAt - BOARDING_HEADS_UP_MS > now) {
      const gate = event.travel?.gate;
      reminders.push({
        id: `travel-board-${event.id}`,
        at: plan.boardingAt - BOARDING_HEADS_UP_MS,
        title: translate("itinerary.reminders.boardingTitle", { name: event.title }),
        body: translate(gate ? "itinerary.reminders.boardingBodyGate" : "itinerary.reminders.boardingBody", {
          time: `${plan.boardingEstimated ? "~" : ""}${clock(plan.boardingAt, hour12)}`,
          gate: gate ?? "",
        }),
        event,
      });
    }
  }
  return reminders;
}

/**
 * Keeps the phone's travel reminders in step with the itinerary: schedules new ones, moves or drops
 * changed ones. Never prompts: it only schedules when notifications are already allowed.
 */
export async function syncTravelReminders(events: TripEvent[], trips: Trip[], homeCountry: string | null, format: ClockFormat, now = Date.now()) {
  try {
    const { granted } = await notifications.getPermission();
    const wanted = new Map((granted ? remindersFor(events, trips, homeCountry, format, now) : []).map((reminder) => [reminder.id, reminder]));
    const scheduled = readScheduled();
    const signature = (reminder: Reminder) => `${reminder.at}|${reminder.title}|${reminder.body}`;

    for (const id of Object.keys(scheduled)) {
      const reminder = wanted.get(id);
      if (reminder && signature(reminder) === scheduled[id]) continue;
      await notifications.cancel(id).catch(() => {});
      delete scheduled[id];
    }
    if (wanted.size > 0) await notifications.setChannel(CHANNEL_ID, { name: translate("itinerary.reminders.channel"), importance: "max" });
    let added = 0;
    for (const reminder of wanted.values()) {
      if (scheduled[reminder.id] === signature(reminder)) continue;
      await notifications.schedule({
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        data: { source: TRAVEL_NOTIFICATION_SOURCE, eventId: reminder.event.id, tripId: reminder.event.tripId ?? "" },
        at: reminder.at,
        channelId: CHANNEL_ID,
      });
      scheduled[reminder.id] = signature(reminder);
      added += 1;
    }
    storage.set(SCHEDULED_KEY, JSON.stringify(scheduled));
    return added;
  } catch (err) {
    logger.warn("travel-reminders", "sync failed", err);
    return 0;
  }
}
