import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Icon, PressableScale, useAura } from "@/atoms";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import { useOpenIdea } from "@/features/itinerary/hooks/useOpenIdea";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { useIdeaThumbsStore } from "@/features/itinerary/store/ideaThumbsStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";

const PROVIDER_NAME = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

/** Links first (newest first), then other ideas such as saved must-dos. */
export function orderIdeas(ideas: TripEvent[]): TripEvent[] {
  const newest = (a: TripEvent, b: TripEvent) => b.createdAt.localeCompare(a.createdAt);
  return [...ideas.filter((idea) => idea.link).sort(newest), ...ideas.filter((idea) => !idea.link).sort(newest)];
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Saved ideas as a sideways row: tap plays a link; tap another idea, or long-press any, to plan or remove it. */
export function IdeaStrip({ tripId, ideas, size = "md", inset = 20 }: { tripId: string; ideas: TripEvent[]; size?: "md" | "sm"; inset?: number }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const openIdea = useOpenIdea();
  const thumbs = useIdeaThumbsStore((state) => state.thumbs);
  const showSaved = useSavedSheetStore((state) => state.show);
  const width = size === "md" ? 136 : 92;
  const mediaHeight = size === "md" ? 168 : 112;
  const act = (idea: TripEvent) => showSaved(tripId, "ideas", "strip", idea.id);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { paddingHorizontal: inset }]} style={{ marginHorizontal: -inset }}>
      {orderIdeas(ideas).map((idea) => {
        const image = idea.link ? (thumbs[idea.id] ?? idea.link.thumbnail) : undefined;
        return (
          <PressableScale
            key={idea.id}
            onPress={() => {
              if (!openIdea(idea)) act(idea);
            }}
            onLongPress={() => act(idea)}
            pressedScale={0.96}
            accessibilityRole="button"
            accessibilityLabel={localizeEventTitle(idea.title, t)}
            accessibilityHint={idea.link ? t("ideas.cardHintLink") : t("ideas.cardHint")}
            style={{ width }}
          >
            <View style={[styles.media, { height: idea.link ? mediaHeight : Math.round(mediaHeight * 0.6), borderColor: c.textMuted, backgroundColor: idea.link ? c.surfaceStrong : `${auraEventColors[idea.type]}1F` }]}>
              {image ? (
                <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Icon name={idea.link ? (idea.link.provider === "web" ? "globe" : "play") : getEventTypeMeta(idea.type).icon} size={size === "md" ? 24 : 18} color={idea.link ? c.textSoft : auraEventColors[idea.type]} />
              )}
              {idea.link && size === "md" ? (
                <View style={styles.badge}>
                  <Text numberOfLines={1} style={[styles.badgeText, { fontFamily: f.semibold }]}>
                    {idea.link.provider === "web" ? hostOf(idea.link.url) : PROVIDER_NAME[idea.link.provider]}
                  </Text>
                </View>
              ) : null}
              {idea.link && idea.link.provider !== "web" ? (
                <View style={styles.play}>
                  <Icon name="play" size={size === "md" ? 12 : 10} color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            <Text numberOfLines={2} style={[size === "md" ? styles.title : styles.titleSm, { color: c.text, fontFamily: f.medium }]}>
              {localizeEventTitle(idea.title, t)}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10 },
  media: { borderRadius: 14, borderWidth: 1.2, borderStyle: "dashed", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 6, left: 6, maxWidth: "85%", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.55)" },
  badgeText: { color: "#FFFFFF", fontSize: 10 },
  play: { position: "absolute", right: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  title: { fontSize: 13, lineHeight: 17, marginTop: 6 },
  titleSm: { fontSize: 11.5, lineHeight: 15, marginTop: 5 },
});
