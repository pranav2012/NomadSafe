import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Canvas, Path, Skia } from "react-native-skia";
import { Easing, useSharedValue, withTiming } from "react-native-reanimated";
import { auraFonts, auraStatusAccent, type AuraPalette } from "@/constants/aura";

const SIZE = 60;
const RING = 4;
const CANVAS = SIZE + RING * 4;
const ALERT = auraStatusAccent.alert;

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

/** Round SOS button in the Home action-row style; a ring fills around it while held. */
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

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <Canvas style={styles.canvas} pointerEvents="none">
          <Path path={ring} style="stroke" strokeWidth={3} strokeCap="round" color={`${ALERT}33`} />
          <Path path={ring} style="stroke" strokeWidth={3} strokeCap="round" color={ALERT} start={0} end={fill} />
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
      <Text numberOfLines={1} style={[styles.label, { color: progress > 0 ? ALERT : palette.textSoft }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 8, flex: 1 },
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  canvas: { position: "absolute", width: CANVAS, height: CANVAS, left: (SIZE - CANVAS) / 2, top: (SIZE - CANVAS) / 2 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: ALERT,
    alignItems: "center",
    justifyContent: "center",
  },
  sos: { color: "#FFFFFF", fontFamily: auraFonts.bold, fontSize: 16, letterSpacing: 0.8 },
  label: { fontFamily: auraFonts.medium, fontSize: 12.5 },
});
