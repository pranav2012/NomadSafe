import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Circle, Group, SweepGradient, useClock, vec } from "react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { auraFonts, type AuraPalette } from "@/constants/aura";

interface ActionButtonProps {
  icon: IconName;
  label: string;
  palette: AuraPalette;
  accent: string;
  /** Sweeps a light beam around the rim, e.g. while location sharing is live. */
  live?: boolean;
  onPress?: () => void;
}

const SIZE = 60;
const BLEED = 18;
const CANVAS = SIZE + BLEED * 2;
const CENTER = CANVAS / 2;

/** Round action with a Skia ripple ring on every press. */
export function ActionButton({ icon, label, palette, accent, live = false, onPress }: ActionButtonProps) {
  const ripple = useSharedValue(1);

  const rippleRadius = useDerivedValue(() => SIZE / 2 + ripple.get() * BLEED);
  const rippleOpacity = useDerivedValue(() => (1 - ripple.get()) * 0.6);

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <PressableScale
          onPress={() => {
            ripple.set(0);
            ripple.set(withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
            onPress?.();
          }}
          pressedScale={0.9}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[
            styles.button,
            { backgroundColor: palette.surfaceStrong, borderColor: live ? `${accent}66` : palette.hairline },
          ]}
        >
          <Icon name={icon} size={22} color={live ? accent : palette.text} strokeWidth={1.9} />
        </PressableScale>
        <Canvas style={styles.canvas} pointerEvents="none">
          <Circle cx={CENTER} cy={CENTER} r={rippleRadius} color={accent} style="stroke" strokeWidth={1.5} opacity={rippleOpacity} />
          {live ? <RimBeam accent={accent} /> : null}
        </Canvas>
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: palette.textSoft }]}>
        {label}
      </Text>
    </View>
  );
}

function RimBeam({ accent }: { accent: string }) {
  const clock = useClock();
  const rotation = useDerivedValue(() => [{ rotate: ((clock.get() / 1000) * Math.PI * 0.9) % (Math.PI * 2) }]);
  return (
    <Group origin={vec(CENTER, CENTER)} transform={rotation}>
      <Circle cx={CENTER} cy={CENTER} r={SIZE / 2 - 0.75} style="stroke" strokeWidth={1.5}>
        <SweepGradient c={vec(CENTER, CENTER)} colors={[`${accent}00`, `${accent}00`, accent, `${accent}00`]} />
      </Circle>
    </Group>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 8, flex: 1 },
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  canvas: { position: "absolute", width: CANVAS, height: CANVAS, left: -BLEED, top: -BLEED },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontFamily: auraFonts.medium, fontSize: 12.5 },
});
