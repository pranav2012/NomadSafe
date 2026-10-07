import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated";
import { Image } from "expo-image";
import { AuraButton, AuraSection, Icon, PressableScale, useAura } from "@/atoms";
import { useOpenIdea } from "@/features/itinerary/hooks/useOpenIdea";
import { useIdeaThumbsStore } from "@/features/itinerary/store/ideaThumbsStore";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { SELF_ID } from "@/features/expenses/utils/split";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import { MustDoRow } from "@/features/itinerary/components/MustDoRow";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import type { MustDo } from "@/features/itinerary/utils/mustDos";

const IDEA_ROWS = 3;
const POPULAR_ROWS = 2;

/** Under a day's plan: your ideas near that day's city (add one to the day), then a couple of popular must-dos to save. */
export function DayIdeas({
  city,
  ideas,
  mustDos,
  onAddToDay,
  onSaveMustDo,
  onDismissMustDo,
}: {
  city?: string;
  ideas: TripEvent[];
  mustDos: MustDo[];
  onAddToDay: (idea: TripEvent) => void;
  onSaveMustDo: (item: MustDo) => void;
  onDismissMustDo: (item: MustDo) => void;
}) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const openIdea = useOpenIdea();
  const thumbs = useIdeaThumbsStore((state) => state.thumbs);
  if (ideas.length === 0 && mustDos.length === 0) return null;
  const saver = (idea: TripEvent) => (idea.savedBy === undefined ? null : idea.savedBy === SELF_ID ? t("ideas.savedByYou") : t("ideas.savedBy", { name: idea.savedBy }));

  return (
    <View>
      {ideas.length > 0 ? (
        <>
          <AuraSection title={city ? t("ideas.inCity", { city }) : t("ideas.yourIdeasTitle")} style={styles.section} />
          <View style={styles.list}>
            {ideas.slice(0, IDEA_ROWS).map((idea) => (
              <Animated.View key={idea.id} layout={LinearTransition.duration(220)} exiting={FadeOut.duration(160)} style={[styles.idea, { borderColor: c.textMuted }]}>
                <PressableScale onPress={() => openIdea(idea)} disabled={!idea.link} accessibilityRole={idea.link ? "button" : undefined} style={styles.open}>
                <View style={[styles.tile, { backgroundColor: `${auraEventColors[idea.type]}22` }]}>
                  {idea.link && (thumbs[idea.id] || idea.link.thumbnail) ? (
                    <Image source={{ uri: thumbs[idea.id] ?? idea.link.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Icon name={idea.link ? "play" : getEventTypeMeta(idea.type).icon} size={16} color={auraEventColors[idea.type]} />
                  )}
                </View>
                <View style={styles.text}>
                  <Text numberOfLines={1} style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
                    {localizeEventTitle(idea.title, t)}
                  </Text>
                  {saver(idea) ? (
                    <Text numberOfLines={1} style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]}>
                      {saver(idea)}
                    </Text>
                  ) : null}
                </View>
                </PressableScale>
                <AuraButton size="md" variant="secondary" label={t("itinerary.day.addToDay")} onPress={() => onAddToDay(idea)} />
              </Animated.View>
            ))}
          </View>
        </>
      ) : null}
      {mustDos.length > 0 ? (
        <>
          <AuraSection title={t("ideas.popularHere")} style={styles.section} />
          <View style={styles.list}>
            {mustDos.slice(0, POPULAR_ROWS).map((item) => (
              <Animated.View key={item.key} layout={LinearTransition.duration(220)} exiting={FadeOut.duration(160)}>
                <MustDoRow item={item} actionLabel={t("home.prep.save")} onAdd={() => onSaveMustDo(item)} onDismiss={() => onDismissMustDo(item)} />
              </Animated.View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24, marginBottom: 12 },
  list: { gap: 10 },
  idea: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, borderWidth: 1.2, borderStyle: "dashed" },
  open: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  tile: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14.5 },
  meta: { fontSize: 12.5 },
});
