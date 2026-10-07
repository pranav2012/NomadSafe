import React from "react";
import { StyleSheet, View } from "react-native";
import { AuraButton, AuraSection } from "@/atoms";
import { useLocalization } from "@/localization";
import { IdeaStrip } from "@/features/itinerary/components/IdeaStrip";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import { ideasOf } from "@/features/itinerary/utils/ideas";

/** Home's "Saved" section for a trip: its ideas inline (links first), with "See all" for the full sheet. Hidden when empty. */
export function SavedSection({ tripId }: { tripId: string }) {
  const { t } = useLocalization();
  const events = useEventsStore((state) => state.events);
  const showSaved = useSavedSheetStore((state) => state.show);
  const ideas = ideasOf(events.filter((event) => event.tripId === tripId));
  if (ideas.length === 0) return null;
  return (
    <View>
      <AuraSection
        title={t("ideas.savedSection")}
        style={styles.section}
        action={<AuraButton label={t("ideas.seeAllShort")} variant="ghost" size="md" onPress={() => showSaved(tripId, "ideas", "strip")} />}
      />
      <IdeaStrip tripId={tripId} ideas={ideas} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 28, marginBottom: 12 },
});
