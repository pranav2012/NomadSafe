import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Canvas, Path, Skia } from "react-native-skia";
import { Easing, useSharedValue, withTiming } from "react-native-reanimated";
import { auraFonts, auraStatusAccent, auraStatusColors, type AuraPalette } from "@/constants/aura";

const SIZE = 74;
const RING = 5;
const CANVAS = SIZE + RING * 4;
const ALERT = auraStatusAccent.alert;
const [GLOW] = auraStatusColors.alert;

interface SosHoldButtonProps {
  /** How far through the hold the user is, 0 to 1. */
  progress: number;
  label: string;
  palette: AuraPalette;
  onPressIn: () => void;
  onPressOut: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  onAccessibilityActivate: () => void;
}

/** Floating round SOS button with its label beside it; a ring fills around it while held. */
export function SosHoldButton({
  progress,
  label,
  palette,
  onPressIn,
  onPressOut,
  accessibilityLabel,
  accessibilityHint,
  onAccessibilityActivate,
}: SosHoldButtonProps) {
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.set(withTiming(progress, { duration: progress === 0 ? 180 : 110, easing: Easing.linear }));
  }, [fill, progress]);

  const ring = useMemo(() => {
    const r = SIZE / 2 + RING;
    return Skia.PathBuilder.Make()
      .addArc({ x: CANVAS / 2 - r, y: CANVAS / 2 - r, width: r * 2, height: r * 2 }, -90, 359.9)
      .detach();
  }, []);

  const holding = progress > 0;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={[styles.label, { backgroundColor: holding ? ALERT : palette.card, borderColor: holding ? ALERT : palette.hairline }]}>
        <Text numberOfLines={1} style={[styles.labelText, { color: holding ? "#FFFFFF" : palette.text }]}>
          {label}
        </Text>
      </View>
      <View style={styles.stage}>
        <Canvas style={styles.canvas} pointerEvents="none">
          <Path path={ring} style="stroke" strokeWidth={3.5} strokeCap="round" color={`${ALERT}40`} />
          <Path path={ring} style="stroke" strokeWidth={3.5} strokeCap="round" color={ALERT} start={0} end={fill} />
        </Canvas>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
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
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  sos: { color: "#FFFFFF", fontFamily: auraFonts.bold, fontSize: 19, letterSpacing: 1 },
});
