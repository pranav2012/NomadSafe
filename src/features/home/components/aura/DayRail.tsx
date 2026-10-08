import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlurMask, Canvas, Path, usePathValue, type SkPathBuilder } from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Easing, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { selectionChanged } from "@/utils/haptics";

interface DayRailProps {
  totalDays: number;
  /** 1-based current day; 0 before the trip starts. */
  today: number;
  colors: { past: string; future: string; today: string; selected?: string };
  onScrub: (index: number | null) => void;
  /** 0-based day kept after a drag or tap; set with `onSelect` to make the rail a day picker. */
  selected?: number | null;
  onSelect?: (index: number) => void;
  height?: number;
  /** 0..1 per day: how full each day is; ticks grow with it (the trip summary). */
  levels?: number[];
}

const PAD = 4;
const TICK_W = 3;

/**
 * One tick per trip day. Ticks rise in a left-to-right wave on mount; dragging across
 * magnifies the ticks under the finger like a dock and reports the day under it. With
 * `onSelect`, the day under the finger when it lifts (or a tapped day) stays picked.
 */
export function DayRail({ totalDays, today, colors, onScrub, selected = null, onSelect, height = 44, levels }: DayRailProps) {
  const [width, setWidth] = useState(0);
  const count = Math.max(1, totalDays);
  const step = count > 1 ? (width - PAD * 2 - TICK_W) / (count - 1) : 0;

  const intro = useSharedValue(0);
  const focus = useSharedValue(-10);
  const lens = useSharedValue(0);
  const lastIndex = useSharedValue(-1);

  useEffect(() => {
    if (width === 0) return;
    intro.set(0);
    intro.set(withDelay(150, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })));
  }, [intro, width]);

  const picked = selected !== null && selected !== today - 1 ? selected : -1;

  const buildTicks = (builder: SkPathBuilder, kind: "past" | "today" | "future" | "selected") => {
    "worklet";
    const progress = intro.get();
    for (let i = 0; i < count; i += 1) {
      const isToday = i === today - 1;
      const isPast = i < today - 1;
      const isPicked = i === picked;
      if ((kind === "selected") !== isPicked) continue;
      if ((kind === "today") !== isToday) continue;
      if (kind === "past" && !isPast) continue;
      if (kind === "future" && (isPast || isToday)) continue;

      const wave = Math.min(1, Math.max(0, progress * (count + 6) / 6 - i / 6));
      const level = levels?.[i];
      const base = isToday ? 30 : isPicked ? 26 : level !== undefined ? 8 + level * (height - 20) : isPast ? 18 : 12;
      const distance = i - focus.get();
      const magnify = 1 + lens.get() * 0.9 * Math.exp(-(distance * distance) / 3);
      const h = Math.min(height, base * magnify) * wave;
      if (h < 0.5) continue;
      const x = PAD + TICK_W / 2 + i * step;
      builder.moveTo(x, height - TICK_W / 2);
      builder.lineTo(x, height - Math.max(TICK_W / 2, h - TICK_W / 2));
    }
  };

  const pastPath = usePathValue((builder) => {
    "worklet";
    buildTicks(builder, "past");
  });
  const todayPath = usePathValue((builder) => {
    "worklet";
    buildTicks(builder, "today");
  });
  const futurePath = usePathValue((builder) => {
    "worklet";
    buildTicks(builder, "future");
  });
  const selectedPath = usePathValue((builder) => {
    "worklet";
    buildTicks(builder, "selected");
  });


  const indexAt = (x: number) => {
    "worklet";
    return Math.min(count - 1, Math.max(0, Math.round(step > 0 ? (x - PAD) / step : 0)));
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .onBegin((event) => {
      focus.set(step > 0 ? (event.x - PAD) / step : 0);
      lens.set(withTiming(1, { duration: 160 }));
    })
    .onChange((event) => {
      const fractional = step > 0 ? (event.x - PAD) / step : 0;
      focus.set(fractional);
      const index = indexAt(event.x);
      if (index !== lastIndex.get()) {
        lastIndex.set(index);
        scheduleOnRN(selectionChanged);
        scheduleOnRN(onScrub, index);
      }
    })
    .onFinalize(() => {
      lens.set(withTiming(0, { duration: 260 }));
      if (onSelect && lastIndex.get() >= 0) scheduleOnRN(onSelect, lastIndex.get());
      lastIndex.set(-1);
      scheduleOnRN(onScrub, null);
    });
  const tap = Gesture.Tap()
    .enabled(Boolean(onSelect))
    .onEnd((event) => {
      if (!onSelect) return;
      scheduleOnRN(selectionChanged);
      scheduleOnRN(onSelect, indexAt(event.x));
    });

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View style={{ height }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Path path={futurePath} color={colors.future} style="stroke" strokeWidth={TICK_W} strokeCap="round" />
            <Path path={pastPath} color={colors.past} style="stroke" strokeWidth={TICK_W} strokeCap="round" />
            <Path path={selectedPath} color={colors.selected ?? colors.today} style="stroke" strokeWidth={TICK_W + 1} strokeCap="round" />
            <Path path={todayPath} color={colors.today} style="stroke" strokeWidth={TICK_W + 1} strokeCap="round">
              <BlurMask blur={7} style="outer" />
            </Path>
            <Path path={todayPath} color={colors.today} style="stroke" strokeWidth={TICK_W + 1} strokeCap="round" />
          </Canvas>
        ) : null}
      </View>
    </GestureDetector>
  );
}
