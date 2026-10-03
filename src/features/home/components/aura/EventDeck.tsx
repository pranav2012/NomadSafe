import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Icon } from "@/components/nomad/Icon";
import { springs } from "@/components/motion/springs";
import { getEventTypeMeta } from "@/features/itinerary";
import { lightImpact } from "@/utils/haptics";
import type { HomeEvent } from "@/features/home/types";
import { auraFonts, type AuraPalette } from "@/constants/aura";

const CARD_HEIGHT = 118;
const PEEK = 10;
const VISIBLE = 3;

interface EventDeckProps {
  events: HomeEvent[];
  palette: AuraPalette;
  accent: string;
}

/** Stacked cards: flick the front card away and it tucks in behind the others. */
export function EventDeck({ events, palette, accent }: EventDeckProps) {
  const [front, setFront] = useState(0);
  const count = events.length;

  return (
    <View style={{ height: CARD_HEIGHT + PEEK * (Math.min(count, VISIBLE) - 1) }}>
      {events.map((event, index) => {
        const position = (index - front + count) % count;
        return (
          <DeckCard
            key={event.id}
            event={event}
            position={position}
            count={count}
            palette={palette}
            accent={accent}
            onDismiss={() => setFront((value) => (value + 1) % count)}
          />
        );
      })}
    </View>
  );
}

function DeckCard({
  event,
  position,
  count,
  palette,
  accent,
  onDismiss,
}: {
  event: HomeEvent;
  position: number;
  count: number;
  palette: AuraPalette;
  accent: string;
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();
  const depth = useSharedValue(position);
  const dragX = useSharedValue(0);
  const isFront = position === 0;

  useEffect(() => {
    depth.set(withSpring(position, springs.snappy));
    dragX.set(withSpring(0, springs.snappy));
  }, [depth, dragX, position]);

  const pan = Gesture.Pan()
    .enabled(isFront && count > 1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onChange((event) => {
      dragX.set(event.translationX);
    })
    .onEnd((event) => {
      const fling = Math.abs(event.translationX) > width * 0.28 || Math.abs(event.velocityX) > 800;
      if (!fling) {
        dragX.set(withSpring(0, springs.snappy));
        return;
      }
      const direction = event.translationX + event.velocityX * 0.1 > 0 ? 1 : -1;
      dragX.set(
        withTiming(direction * width, { duration: 180 }, (finished) => {
          if (finished) scheduleOnRN(onDismiss);
        }),
      );
      scheduleOnRN(lightImpact);
    });

  const style = useAnimatedStyle(() => {
    const d = depth.get();
    return {
      opacity: d > VISIBLE - 1 ? Math.max(0, VISIBLE - d) : 1 - d * 0.22,
      transform: [
        { translateY: (VISIBLE - 1) * PEEK - d * PEEK },
        { translateX: dragX.get() },
        { rotate: `${dragX.get() / 24}deg` },
        { scale: 1 - d * 0.05 },
      ],
    };
  });

  const meta = getEventTypeMeta(event.type);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.card,
          { zIndex: count - position, backgroundColor: palette.card, borderColor: palette.hairline },
          style,
        ]}
      >
        <View style={[styles.topHighlight, { backgroundColor: palette.highlight }]} />
        <View style={styles.row}>
          <View style={[styles.iconChip, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
            <Icon name={meta.icon} size={18} color={palette.text} />
          </View>
          <Text style={[styles.time, { color: accent }]}>{event.time}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
          {event.title}
        </Text>
        {event.detail ? (
          <Text numberOfLines={1} style={[styles.detail, { color: palette.textMuted }]}>
            {event.detail}
          </Text>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: CARD_HEIGHT,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 6,
    overflow: "hidden",
  },
  topHighlight: { position: "absolute", top: 0, left: 24, right: 24, height: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  time: { fontFamily: auraFonts.semibold, fontSize: 13, fontVariant: ["tabular-nums"] },
  title: { fontFamily: auraFonts.semibold, fontSize: 17, letterSpacing: -0.2, marginTop: 4 },
  detail: { fontFamily: auraFonts.regular, fontSize: 13.5 },
});
