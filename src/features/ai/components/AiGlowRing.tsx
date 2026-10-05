import React, { useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { BlurMask, Canvas, Group, RoundedRect, SweepGradient, vec } from "react-native-skia";
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { auraStatusColors } from "@/constants/aura";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";

export type AiGlowMode = "off" | "focus" | "active";

const [BLUE, TEAL, VIOLET] = auraStatusColors.calm;
const COLORS = [BLUE, TEAL, VIOLET, BLUE];
/** Room the ring needs around the panel for its glow; the parent must pad the panel by this much. */
export const GLOW_BLEED = 44;
const BLEED = GLOW_BLEED;
const STROKE = 1.5;

/**
 * Aura-coloured gradient ring that hugs a rounded panel: faint and slow while `focus`,
 * bright with a soft outer glow and a fast spin while `active` (the AI is replying).
 * Fills its parent, which must be the panel plus GLOW_BLEED on every side: Android clips
 * drawing to a view's bounds, so the glow can't spill outside its own box.
 */
export function AiGlowRing({ mode, radius }: { mode: AiGlowMode; radius: number }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reduceMotion = useReducedMotion();
  const animating = useAnimationsActive();
  const angle = useSharedValue(0);
  const speed = useSharedValue(0);
  const ring = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    speed.set(withTiming(mode === "active" ? 3.2 : 0.7, { duration: 500 }));
    ring.set(withTiming(mode === "active" ? 1 : mode === "focus" ? 0.55 : 0, { duration: 350 }));
    glow.set(withTiming(mode === "active" ? 0.75 : 0, { duration: 450 }));
  }, [glow, mode, ring, speed]);

  const spin = useFrameCallback((frame) => {
    angle.set((angle.get() + ((frame.timeSincePreviousFrame ?? 16) / 1000) * speed.get()) % (Math.PI * 2));
  }, false);
  useEffect(() => {
    spin.setActive(animating && !reduceMotion && mode !== "off");
  }, [animating, mode, reduceMotion, spin]);

  const center = vec(size.width / 2, size.height / 2);
  const transform = useDerivedValue(() => [{ rotate: angle.get() }]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width: Math.round(width), height: Math.round(height) });
  };

  const rect = {
    x: BLEED + STROKE / 2,
    y: BLEED + STROKE / 2,
    width: size.width - BLEED * 2 - STROKE,
    height: size.height - BLEED * 2 - STROKE,
    r: radius,
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size.width > BLEED * 2 ? (
        <Canvas style={{ width: size.width, height: size.height }}>
          <Group opacity={glow}>
            <BlurMask blur={9} style="normal" />
            <RoundedRect {...rect} style="stroke" strokeWidth={6}>
              <SweepGradient c={center} colors={COLORS} origin={center} transform={transform} />
            </RoundedRect>
          </Group>
          <RoundedRect {...rect} style="stroke" strokeWidth={STROKE} opacity={ring}>
            <SweepGradient c={center} colors={COLORS} origin={center} transform={transform} />
          </RoundedRect>
        </Canvas>
      ) : null}
    </View>
  );
}

