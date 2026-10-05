import React from "react";
import { BlurMask, DashPathEffect, Group, LinearGradient, Path, vec } from "react-native-skia";
import type { SharedValue } from "react-native-reanimated";

type Animated = number | SharedValue<number>;

// Same geometry as assets/brand/*.svg (512-unit artboard), so the native splash image and this drawing line up.
const ARTBOARD = 512;
const N_PATH = "M184 340 V172 L328 340 V172";
const ARC_PATH = "M92 380 C170 430 342 430 420 380";
const AURORA = ["#22C7B8", "#5B6CFF", "#9B7BFF"];
const AURORA_STOPS = [0, 0.55, 1];

/** The NomadSafe logo inside a Skia Canvas; `size` is the artboard in dp, `start`/`end` trim the N, `glow`/`arc` run 0..1. */
export function NomadMark({
  size,
  isDark,
  x = 0,
  y = 0,
  start = 0,
  end = 1,
  glow = 1,
  arc = 1,
}: {
  size: number;
  isDark: boolean;
  x?: number;
  y?: number;
  start?: Animated;
  end?: Animated;
  glow?: Animated;
  arc?: Animated;
}) {
  const stroke = { style: "stroke" as const, strokeWidth: 46, strokeCap: "round" as const, strokeJoin: "round" as const };
  const aurora = <LinearGradient start={vec(96, 420)} end={vec(416, 92)} colors={AURORA} positions={AURORA_STOPS} />;

  return (
    <Group transform={[{ translateX: x }, { translateY: y }, { scale: size / ARTBOARD }]}>
      <Group opacity={glow}>
        <Path path={N_PATH} {...stroke} start={start} end={end} opacity={isDark ? 0.75 : 0.5}>
          {aurora}
          <BlurMask blur={18} style="normal" />
        </Path>
      </Group>
      <Path path={N_PATH} {...stroke} start={start} end={end}>
        {aurora}
      </Path>
      <Path
        path={ARC_PATH}
        style="stroke"
        strokeWidth={6}
        strokeCap="round"
        color={isDark ? "#EDEFF5" : "#5B6CFF"}
        opacity={0.55}
        end={arc}
      >
        <DashPathEffect intervals={[2, 14]} />
      </Path>
    </Group>
  );
}
