import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { auraDark } from "@/constants/aura";
import { selectionChanged } from "@/utils/haptics";

const c = auraDark;
// A page stops at this angle as it turns away; past it the next page is fully revealed.
const MAX_ANGLE = 105;
const EDGE_STRIPS = 3;
const SETTLE = { damping: 20, stiffness: 140, mass: 0.9 };
const WINDOW = 2;

interface Props {
  pages: React.ReactNode[];
  width: number;
  height: number;
  onPageChange?: (index: number) => void;
}

/**
 * Pages bound at a spine on the left, turned like a real passport: drag (or tap an edge) and the top
 * page swings away around the spine, shading as it turns and revealing the next page beneath.
 */
export function PassportBook({ pages, width, height, onPageChange }: Props) {
  const reduceMotion = useReducedMotion();
  const last = pages.length - 1;
  const turn = useSharedValue(0);
  const start = useSharedValue(0);
  const [open, setOpen] = useState(0);

  const settle = (target: number) => {
    "worklet";
    const clamped = Math.max(0, Math.min(last, target));
    turn.set(withSpring(clamped, SETTLE));
  };

  useAnimatedReaction(
    () => Math.round(turn.get()),
    (index, previous) => {
      if (previous === null || index === previous) return;
      scheduleOnRN(selectionChanged);
      scheduleOnRN(setOpen, index);
      if (onPageChange) scheduleOnRN(onPageChange, index);
    },
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onBegin(() => {
      start.set(turn.get());
    })
    .onUpdate((event) => {
      const next = start.get() - event.translationX / (width * 0.85);
      // A little resistance past the first and last page.
      turn.set(next < 0 ? next * 0.25 : next > last ? last + (next - last) * 0.25 : next);
    })
    .onEnd((event) => {
      const from = start.get();
      const moved = turn.get() - from;
      const fling = -event.velocityX / width;
      const target = Math.abs(fling) > 0.6 ? from + Math.sign(fling) : Math.abs(moved) > 0.3 ? from + Math.sign(moved) : from;
      settle(Math.round(target));
    });

  const tap = Gesture.Tap().onEnd((event) => {
    const current = Math.round(turn.get());
    settle(event.x > width * 0.62 ? current + 1 : event.x < width * 0.25 ? current - 1 : current);
  });

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View style={{ width, height }} accessible accessibilityRole="adjustable" accessibilityLabel={`${open + 1} / ${pages.length}`}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const current = Math.round(turn.get());
          turn.set(withSpring(Math.max(0, Math.min(last, current + (event.nativeEvent.actionName === "increment" ? 1 : -1))), SETTLE));
        }}
      >
        <PageEdges count={Math.min(EDGE_STRIPS, last - open)} height={height} />
        {pages.map((page, index) =>
          Math.abs(index - open) <= WINDOW ? (
            <Leaf key={index} index={index} count={pages.length} turn={turn} width={width} height={height} reduceMotion={reduceMotion}>
              {page}
            </Leaf>
          ) : null,
        )}
      </View>
    </GestureDetector>
  );
}

/** The stacked edges of the pages still to come, peeking out on the right. */
function PageEdges({ count, height }: { count: number; height: number }) {
  return (
    <>
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.edge, { right: -(i + 1) * 3, top: (i + 1) * 3, height: height - (i + 1) * 6, opacity: 0.55 - i * 0.14 }]}
        />
      ))}
    </>
  );
}

function Leaf({
  index,
  count,
  turn,
  width,
  height,
  reduceMotion,
  children,
}: {
  index: number;
  count: number;
  turn: SharedValue<number>;
  width: number;
  height: number;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  // How far this page has turned: 0 lying open (or still under the pages above), 1 turned away.
  const style = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, turn.get() - index));
    if (reduceMotion) return { opacity: 1 - progress, zIndex: count - index, transform: [] };
    const angle = -MAX_ANGLE * progress;
    return {
      zIndex: count - index,
      opacity: progress >= 1 ? 0 : 1,
      // Rotate about the left edge (the spine), not the centre.
      transform: [{ perspective: 1600 }, { translateX: -width / 2 }, { rotateY: `${angle}deg` }, { translateX: width / 2 }],
    };
  });
  // The turning page darkens as it swings away from the light.
  const turnShade = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, turn.get() - index));
    return { opacity: interpolate(progress, [0, 0.9], [0, 0.55], Extrapolation.CLAMP) };
  });
  // The page beneath sits in the turning page's shadow, strongest near the spine.
  const underShade = useAnimatedStyle(() => {
    const above = turn.get() - (index - 1);
    return { opacity: above > 0 && above < 1 ? interpolate(above, [0, 0.15, 1], [0, 0.5, 0], Extrapolation.CLAMP) : 0 };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.leaf, { width, height }, style]}>
      {children}
      <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0.38)", "rgba(0,0,0,0.12)", "rgba(0,0,0,0)"]} locations={[0, 0.05, 0.14]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shadeDark, turnShade]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, underShade]}>
        <LinearGradient colors={["rgba(0,0,0,0.7)", "rgba(0,0,0,0)"]} start={{ x: 0, y: 0.5 }} end={{ x: 0.6, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  leaf: { borderTopRightRadius: 28, borderBottomRightRadius: 28, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: c.highlight, backfaceVisibility: "hidden" },
  edge: { position: "absolute", width: 20, borderTopRightRadius: 26, borderBottomRightRadius: 26, borderWidth: 1, borderLeftWidth: 0, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "#141821" },
  shadeDark: { backgroundColor: "#000" },
});
