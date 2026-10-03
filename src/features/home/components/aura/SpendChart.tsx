import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Path,
  Skia,
  usePathValue,
  vec,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Easing, useDerivedValue, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { springs } from "@/components/motion/springs";
import { selectionChanged } from "@/utils/haptics";

interface SpendChartProps {
  values: number[];
  accent: string;
  guide: string;
  onScrub: (index: number | null) => void;
  height?: number;
}

const PAD_X = 6;
const PAD_TOP = 14;
const PAD_BOTTOM = 6;

/**
 * Daily spend as a smooth area chart that wipes in from the left. Dragging snaps a
 * glowing cursor to each day (with a haptic tick) and reports the day under the finger.
 */
export function SpendChart({ values, accent, guide, onScrub, height = 120 }: SpendChartProps) {
  const [width, setWidth] = useState(0);
  const series = useMemo(() => (values.length > 0 ? values : [0]), [values]);
  const max = Math.max(1, ...series) * 1.15;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const stepX = series.length > 1 ? (width - PAD_X * 2) / (series.length - 1) : 0;
  const points = useMemo(
    () =>
      series.map((value, i) => ({
        x: series.length > 1 ? PAD_X + i * stepX : width / 2,
        y: PAD_TOP + (1 - value / max) * plotH,
      })),
    [max, plotH, series, stepX, width],
  );

  // Catmull-Rom through the points, converted to cubic Béziers for a smooth line.
  const { line, area } = useMemo(() => {
    const builder = Skia.PathBuilder.Make();
    points.forEach((p, i) => {
      if (i === 0) return builder.moveTo(p.x, p.y);
      const p0 = points[i - 2] ?? points[i - 1];
      const p1 = points[i - 1];
      const p3 = points[i + 1] ?? p;
      builder.cubicTo(
        p1.x + (p.x - p0.x) / 6,
        p1.y + (p.y - p0.y) / 6,
        p.x - (p3.x - p1.x) / 6,
        p.y - (p3.y - p1.y) / 6,
        p.x,
        p.y,
      );
    });
    const linePath = builder.build();
    const last = points[points.length - 1];
    builder.lineTo(last.x, height).lineTo(points[0].x, height).close();
    return { line: linePath, area: builder.detach() };
  }, [height, points]);

  const reveal = useSharedValue(0);
  const cursorX = useSharedValue(0);
  const cursorOn = useSharedValue(0);
  const lastIndex = useSharedValue(-1);

  useEffect(() => {
    if (width === 0) return;
    reveal.set(0);
    reveal.set(withDelay(250, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) })));
  }, [reveal, width]);

  const clip = usePathValue((builder) => {
    "worklet";
    const w = width * reveal.get();
    builder.moveTo(0, 0).lineTo(w, 0).lineTo(w, height).lineTo(0, height).close();
  });
  const cursorY = useDerivedValue(() => {
    if (points.length === 1) return points[0].y;
    const f = Math.min(points.length - 1, Math.max(0, (cursorX.get() - PAD_X) / Math.max(1, stepX)));
    const i = Math.floor(f);
    const next = points[Math.min(points.length - 1, i + 1)];
    return points[i].y + (next.y - points[i].y) * (f - i);
  });
  const cursorTop = useDerivedValue(() => vec(cursorX.get(), PAD_TOP - 6));
  const cursorBottom = useDerivedValue(() => vec(cursorX.get(), height));
  const cursorOpacity = useDerivedValue(() => cursorOn.get());

  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .onBegin((event) => {
      cursorX.set(event.x);
      cursorOn.set(withTiming(1, { duration: 140 }));
    })
    .onChange((event) => {
      const index =
        points.length > 1 ? Math.min(points.length - 1, Math.max(0, Math.round((event.x - PAD_X) / stepX))) : 0;
      if (index !== lastIndex.get()) {
        lastIndex.set(index);
        cursorX.set(withSpring(points[index].x, springs.press));
        scheduleOnRN(selectionChanged);
        scheduleOnRN(onScrub, index);
      }
    })
    .onFinalize(() => {
      cursorOn.set(withTiming(0, { duration: 220 }));
      lastIndex.set(-1);
      scheduleOnRN(onScrub, null);
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ height }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Group clip={clip}>
              <Path path={area}>
                <LinearGradient start={vec(0, PAD_TOP)} end={vec(0, height)} colors={[`${accent}55`, `${accent}00`]} />
              </Path>
              <Path path={line} style="stroke" strokeWidth={2.5} color={accent} strokeCap="round" strokeJoin="round">
                <BlurMask blur={8} style="solid" />
              </Path>
            </Group>
            <Group opacity={cursorOpacity}>
              <Line p1={cursorTop} p2={cursorBottom} color={guide} strokeWidth={1} />
              <Circle cx={cursorX} cy={cursorY} r={10} color={`${accent}40`} />
              <Circle cx={cursorX} cy={cursorY} r={4.5} color={accent} />
            </Group>
          </Canvas>
        ) : null}
      </View>
    </GestureDetector>
  );
}
