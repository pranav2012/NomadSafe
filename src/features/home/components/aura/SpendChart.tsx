import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, Group, RoundedRect, Skia, rect, vec } from "react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { auraCategoryColors } from "@/constants/aura";
import type { HomeSpendDay } from "@/features/home/types";

interface SpendChartProps {
  days: HomeSpendDay[];
  /** Today's bar is drawn at full strength; null when no day is today. */
  todayIndex: number | null;
  guide: string;
  height?: number;
}

const PAD_TOP = 4;
const TICK_H = 3;
const BAR_FILL = 0.62;
const MAX_BAR_W = 14;
const SEG_GAP = 1.5;

/**
 * Each trip day as a bar stacked by category, with faint ticks for the days ahead.
 * Display only: the bars rise once on mount and never respond to touch.
 */
export function SpendChart({ days, todayIndex, guide, height = 84 }: SpendChartProps) {
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...days.map((day) => (day.upcoming ? 0 : day.amount)));
  const slot = days.length > 0 ? width / days.length : 0;
  const barW = Math.min(MAX_BAR_W, Math.max(2, slot * BAR_FILL));
  const radius = Math.min(3, barW / 2);
  const plotH = height - PAD_TOP;

  // Segments stack bottom-up; each bar is clipped to one rounded rect so only its top is rounded.
  const bars = useMemo(
    () =>
      days.map((day, i) => {
        const x = i * slot + (slot - barW) / 2;
        if (day.upcoming || day.amount <= 0) return { x, upcoming: true, clip: null, segments: [] };
        const barH = Math.max(TICK_H, (day.amount / max) * plotH);
        let top = height;
        const segments = day.parts.map((part) => {
          const h = (part.amount / day.amount) * barH;
          top -= h;
          return { key: part.category, y: top, h: Math.max(0, h - SEG_GAP), color: auraCategoryColors[part.category] };
        });
        const clip = Skia.RRectXY(rect(x, height - barH, barW, barH + radius), radius, radius);
        return { x, upcoming: false, clip, segments };
      }),
    [barW, days, height, max, plotH, radius, slot],
  );

  const reveal = useSharedValue(0);
  useEffect(() => {
    if (width === 0) return;
    reveal.set(0);
    reveal.set(withDelay(250, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) })));
  }, [reveal, width]);
  const grow = useDerivedValue(() => [{ scaleY: reveal.get() }]);

  return (
    <View style={{ height }} pointerEvents="none" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {bars.map((bar, i) =>
            bar.upcoming ? (
              <RoundedRect key={i} x={bar.x} y={height - TICK_H} width={barW} height={TICK_H} r={TICK_H / 2} color={guide} />
            ) : null,
          )}
          <Group transform={grow} origin={vec(0, height)}>
            {bars.map((bar, i) =>
              bar.clip ? (
                <Group key={i} clip={bar.clip} opacity={todayIndex === null || i === todayIndex ? 1 : 0.7}>
                  {bar.segments.map((segment) => (
                    <RoundedRect key={segment.key} x={bar.x} y={segment.y} width={barW} height={segment.h} r={0} color={segment.color} />
                  ))}
                </Group>
              ) : null,
            )}
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}
