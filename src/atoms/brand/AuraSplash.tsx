import React, { useEffect, useRef, useState } from "react";
import { Appearance, StyleSheet, type LayoutChangeEvent } from "react-native";
import { Canvas } from "react-native-skia";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { auraDark, auraLight } from "@/constants/aura";
import { NomadMark } from "./NomadMark";

// app.json's splash imageWidth: the native splash draws the 512-unit artboard at this size.
const MARK_SIZE = 200;
const EXIT_MS = 320;

/** Takes over from the native splash with the same N, animates while the app loads and fades out once `ready`. */
export function AuraSplash({
  ready,
  onFirstFrame,
  onDone,
}: {
  ready: boolean;
  onFirstFrame?: () => void;
  onDone: () => void;
}) {
  // Matches the native splash, which follows the phone's theme rather than the app setting.
  const [isDark] = useState(() => Appearance.getColorScheme() !== "light");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const glow = useSharedValue(0);
  const arc = useSharedValue(0);
  const exit = useSharedValue(0);
  const firstFrameSent = useRef(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (!size || firstFrameSent.current) return;
    firstFrameSent.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setDrawn(true);
        onFirstFrame?.();
      }),
    );
    if (!reduceMotion) {
      glow.set(
        withSequence(
          withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
          withRepeat(withTiming(0.6, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true),
        ),
      );
      arc.set(withDelay(250, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) })));
    }
  }, [arc, glow, onFirstFrame, reduceMotion, size]);

  useEffect(() => {
    if (!ready || !drawn) return;
    exit.set(
      withDelay(
        60,
        withTiming(1, { duration: EXIT_MS, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) scheduleOnRN(onDone);
        }),
      ),
    );
  }, [drawn, exit, onDone, ready]);

  const fade = useAnimatedStyle(() => ({
    opacity: 1 - exit.get(),
    transform: [{ scale: 1 + exit.get() * 0.06 }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <Animated.View
      pointerEvents={ready ? "none" : "auto"}
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { backgroundColor: (isDark ? auraDark : auraLight).bg }, fade]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {size ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <NomadMark
            size={MARK_SIZE}
            isDark={isDark}
            x={(size.width - MARK_SIZE) / 2}
            y={(size.height - MARK_SIZE) / 2}
            glow={glow}
            arc={arc}
          />
        </Canvas>
      ) : null}
    </Animated.View>
  );
}
