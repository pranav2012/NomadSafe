import { storage } from "@/modules/storage";
import { WIDGET_TOKEN_PARAM } from "@/features/widget/widgetToken";
import {
  pickDefaultActiveTripId,
  useTripsStore,
  type Trip,
} from "@/features/trips/store/tripsStore";

const WIDGET_TRIP_KEY = "widget.voiceTripId";

export function setWidgetTripId(tripId: string | null) {
  if (tripId) storage.set(WIDGET_TRIP_KEY, tripId);
  else storage.remove(WIDGET_TRIP_KEY);
}

/** The trip the widget adds to: its own pick, else the active trip, else the current/next trip. */
export function resolveWidgetTrip(): Trip | null {
  const { trips, activeTripId } = useTripsStore.getState();
  const pickedId = storage.getString(WIDGET_TRIP_KEY);
  const byId = (id: string | null | undefined) => (id ? trips.find((trip) => trip.id === id) : undefined);
  return byId(pickedId) ?? byId(activeTripId) ?? byId(pickDefaultActiveTripId(trips)) ?? trips[0] ?? null;
}

/** A voice widget link; without this install's token the app drops `autostart` and the widget source. */
export function voiceCaptureUrl(options: { tripId?: string | null; autostart?: boolean; pickTrip?: boolean; token: string }) {
  const params = new URLSearchParams({ source: "widget", [WIDGET_TOKEN_PARAM]: options.token });
  if (options.tripId) params.set("tripId", options.tripId);
  if (options.autostart) params.set("autostart", "1");
  if (options.pickTrip) params.set("pickTrip", "1");
  return `nomadsafe://voice-expense?${params.toString()}`;
}
