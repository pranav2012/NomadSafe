import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Canvas, Path, Skia } from "react-native-skia";
import { Easing, cancelAnimation, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { auraFonts, auraStatusAccent, auraStatusColors, type AuraPalette } from "@/constants/aura";

const SIZE = 60;
const RING = 5;
const CANVAS = SIZE + RING * 4;
const ALERT = auraStatusAccent.alert;
const [GLOW] = auraStatusColors.alert;
const SPRING_BACK = { damping: 22, stiffness: 320, overshootClamping: true };

interface SosHoldButtonProps {
  /** How long the button must be held, in ms. */
  holdMs: number;
  idleLabel: string;
  holdingLabel: string;
  palette: AuraPalette;
  /** Return false to ignore a press (e.g. a countdown is already running). */
  canHold: () => boolean;
  onHoldComplete: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  onAccessibilityActivate: () => void;
}

/**
 * Floating round SOS button with its label beside it. Holding fills a ring on the UI thread and
 * calls `onHoldComplete` once full; letting go early springs it back. No React state per frame.
 */
export function SosHoldButton({
  holdMs,
  idleLabel,
  holdingLabel,
  palette,
  canHold,
  onHoldComplete,
  accessibilityLabel,
  accessibilityHint,
  onAccessibilityActivate,
}: SosHoldButtonProps) {
  const fill = useSharedValue(0);
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  const complete = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    fill.set(withTiming(0, { duration: 180 }));
    onHoldComplete();
  }, [fill, onHoldComplete]);

  const pressIn = useCallback(() => {
    if (!canHold()) return;
    holdingRef.current = true;
    setHolding(true);
    fill.set(0);
    fill.set(withTiming(1, { duration: holdMs, easing: Easing.linear }, (finished) => {
      if (finished) scheduleOnRN(complete);
    }));
  }, [canHold, complete, fill, holdMs]);

  const pressOut = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    cancelAnimation(fill);
    fill.set(withSpring(0, SPRING_BACK));
  }, [fill]);

  useEffect(() => () => cancelAnimation(fill), [fill]);

  const ring = useMemo(() => {
    const r = SIZE / 2 + RING;
    return Skia.PathBuilder.Make()
      .addArc({ x: CANVAS / 2 - r, y: CANVAS / 2 - r, width: r * 2, height: r * 2 }, -90, 359.9)
      .detach();
  }, []);

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={[styles.label, { backgroundColor: holding ? ALERT : palette.card, borderColor: holding ? ALERT : palette.hairline }]}>
        <Text numberOfLines={1} style={[styles.labelText, { color: holding ? "#FFFFFF" : palette.text }]}>
          {holding ? holdingLabel : idleLabel}
        </Text>
      </View>
      <View style={styles.stage}>
        <Canvas style={styles.canvas} pointerEvents="none">
          <Path path={ring} style="stroke" strokeWidth={3.5} strokeCap="round" color={`${ALERT}40`} />
          <Path path={ring} style="stroke" strokeWidth={3.5} strokeCap="round" color={ALERT} start={0} end={fill} />
        </Canvas>
        <Pressable
          onPressIn={pressIn}
          onPressOut={pressOut}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityActions={[{ name: "activate", label: accessibilityLabel }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "activate") onAccessibilityActivate();
          }}
          style={({ pressed }) => [styles.button, { transform: [{ scale: pressed ? 0.92 : 1 }] }]}
        >
          <Text style={styles.sos}>SOS</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, justifyContent: "center" },
  labelText: { fontFamily: auraFonts.semibold, fontSize: 13 },
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  canvas: { position: "absolute", width: CANVAS, height: CANVAS, left: (SIZE - CANVAS) / 2, top: (SIZE - CANVAS) / 2 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: ALERT,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GLOW,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  sos: { color: "#FFFFFF", fontFamily: auraFonts.bold, fontSize: 16, letterSpacing: 0.8 },
});
