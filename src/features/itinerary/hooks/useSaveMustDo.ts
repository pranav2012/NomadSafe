import { showToast } from "@/atoms";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { SELF_ID } from "@/features/expenses/utils/split";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import type { MustDo } from "@/features/itinerary/utils/mustDos";
import { toWallClock } from "@/features/itinerary/utils/wallClock";
import { fromDateKey } from "@/features/trips/utils/dates";

type Where = "trip_prep" | "day_ideas" | "saved_sheet";

/** Saves a must-do as a trip idea pinned to its place; no toast inside the Saved sheet, where Android draws toasts underneath. */
export function useSaveMustDo() {
  const { t } = useLocalization();
  const addEvent = useEventsStore((state) => state.addEvent);
  const showSheet = useSavedSheetStore((state) => state.show);
  return (trip: { id: string; name: string; startDate: string }, item: MustDo, where: Where) => {
    track("must_do_suggestion", { action: "added", where });
    addEvent({
      tripId: trip.id,
      type: item.type,
      title: item.name,
      startAt: toWallClock(fromDateKey(trip.startDate)),
      timing: "wishlist",
      source: "manual",
      savedBy: SELF_ID,
      place: { name: item.name, latitude: item.latitude, longitude: item.longitude },
    });
    if (where === "saved_sheet") return;
    showToast(t("ideas.savedTitle", { trip: trip.name }), item.name, {
      label: t("ideas.view"),
      onPress: () => showSheet(trip.id, "ideas", "toast"),
    });
  };
}
