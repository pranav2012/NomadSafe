import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Icon, PressableScale } from "@/atoms";
import { useLocalization } from "@/localization";
import { c } from "./replayStyles";

const HOLD_MS = 220;

function Segment({ state, progress }: { state: "done" | "current" | "todo"; progress: SharedValue<number> }) {
  const animated = useAnimatedStyle(() => ({ width: `${(state === "done" ? 1 : state === "current" ? progress.get() : 0) * 100}%` }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, animated]} />
    </View>
  );
}

/** Story segments (tap one to jump), mute and close; fades away while the replay is held. */
export function ReplayHeader({
  count,
  index,
  progress,
  top,
  hidden,
  muted,
  onJump,
  onToggleMute,
  onClose,
}: {
  count: number;
  index: number;
  progress: SharedValue<number>;
  top: number;
  hidden: boolean;
  muted: boolean;
  onJump: (index: number) => void;
  onToggleMute: () => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const visible = useSharedValue(1);
  useEffect(() => {
    visible.set(withTiming(hidden ? 0 : 1, { duration: 200 }));
  }, [hidden, visible]);
  const fade = useAnimatedStyle(() => ({ opacity: visible.get() }));
  return (
    <Animated.View style={[styles.header, { paddingTop: top + 10 }, fade]} pointerEvents={hidden ? "none" : "box-none"}>
      <View style={styles.segments}>
        {Array.from({ length: count }, (_, i) => (
          <PressableScale
            key={i}
            onPress={() => onJump(i)}
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel={t("recap.chapterLabel", { n: i + 1, total: count })}
            style={styles.segmentHit}
          >
            <Segment state={i < index ? "done" : i === index ? "current" : "todo"} progress={progress} />
          </PressableScale>
        ))}
      </View>
      <View style={styles.row}>
        <View style={styles.flex} />
        <PressableScale onPress={onToggleMute} accessibilityRole="button" accessibilityLabel={muted ? t("recap.unmute") : t("recap.mute")} style={styles.round}>
          <Icon name={muted ? "volumeOff" : "volume"} size={16} color={c.text} />
        </PressableScale>
        <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel={t("trip.close")} style={styles.round}>
          <Icon name="x" size={16} color={c.text} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

/**
 * Story controls over the whole screen: tap the right part for the next chapter, the left third for
 * the previous one, and press and hold to pause until released. Screen readers get the same as actions.
 */
export function TapZones({ onPrevious, onNext, onHold, onTogglePlay, playing }: { onPrevious: () => void; onNext: () => void; onHold: (held: boolean) => void; onTogglePlay: () => void; playing: boolean }) {
  const { t } = useLocalization();
  const { width } = useWindowDimensions();
  const held = useRef(false);
  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      delayLongPress={HOLD_MS}
      onLongPress={() => {
        held.current = true;
        onHold(true);
      }}
      onPressOut={() => {
        if (!held.current) return;
        held.current = false;
        onHold(false);
      }}
      onPress={(event) => (event.nativeEvent.locationX < width / 3 ? onPrevious() : onNext())}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t("recap.replayLabel")}
      accessibilityHint={t("recap.replayHint")}
      accessibilityActions={[
        { name: "increment", label: t("recap.next") },
        { name: "decrement", label: t("recap.previous") },
        { name: "activate", label: playing ? t("recap.pause") : t("recap.play") },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") onNext();
        else if (event.nativeEvent.actionName === "decrement") onPrevious();
        else if (event.nativeEvent.actionName === "activate") onTogglePlay();
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 8 },
  segments: { flexDirection: "row", gap: 4 },
  segmentHit: { flex: 1, paddingVertical: 6 },
  segment: { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: c.hairline },
  segmentFill: { height: 3, borderRadius: 2, backgroundColor: c.text },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceStrong },
});
