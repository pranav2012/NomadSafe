import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  type LayoutChangeEvent,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import Svg, {
  Path,
  Circle,
  G,
  Line,
  Ellipse,
  Text as SvgText,
} from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";
import type { NomadTheme } from "@/constants/nomadTokens";

export type MapPin = {
  x: number;
  y: number;
  color?: `#${string}` | `rgba(${string})` | string;
  label?: string;
  pulse?: boolean;
  type?: "user" | "stamp" | "default";
  initial?: string;
  sub?: string;
  rot?: number;
  name?: string;
};

interface TravelMapProps {
  theme: NomadTheme;
  dark: boolean;
  pins?: MapPin[];
  route?: { x: number; y: number }[];
  height?: number;
  lowBattery?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VIEWBOX_WIDTH = 400;
const VIEWBOX_HEIGHT = 300;
const BORDER = 1;

/** Maps a viewBox point to layout pixels, matching `preserveAspectRatio="xMidYMid slice"`. */
function projectSlice(x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / VIEWBOX_WIDTH, height / VIEWBOX_HEIGHT);
  return {
    left: (width - VIEWBOX_WIDTH * scale) / 2 + x * scale,
    top: (height - VIEWBOX_HEIGHT * scale) / 2 + y * scale,
  };
}

function PulseRing({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.8);
  useEffect(() => {
    scale.value = withRepeat(
      withTiming(2.4, { duration: 2000, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 0 }),
        withTiming(0, { duration: 2000, easing: Easing.out(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [scale, opacity]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: color,
          left: -16,
          top: -16,
          opacity: 0.2,
        },
        aStyle,
      ]}
    />
  );
}

export function TravelMap({
  theme,
  dark,
  pins = [],
  route = [],
  height = 240,
  lowBattery = false,
  style,
}: TravelMapProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height: layoutHeight } = event.nativeEvent.layout;
    setSize((current) =>
      current?.width === width && current.height === layoutHeight
        ? current
        : { width, height: layoutHeight },
    );
  };
  const landFill = dark ? "#223034" : "#E8DEC6";
  const landStroke = dark ? "#2C3C42" : "#D6C8AA";
  const water = dark ? "#1A2326" : "#D6E4E0";
  const roadColor = dark ? "rgba(217,164,65,0.22)" : "rgba(198,67,42,0.18)";
  const dashed = dark ? "#D9A441" : "#C6432A";
  const gridColor = dark ? "rgba(240,230,214,0.04)" : "rgba(26,22,18,0.04)";

  const routeD =
    route.length > 1 ? `M${route.map((p) => `${p.x},${p.y}`).join(" L")}` : "";

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.root,
        {
          height,
          backgroundColor: water,
          borderColor: theme.hairline,
        },
        style,
      ]}
    >
      <Svg
        viewBox="0 0 400 300"
        preserveAspectRatio="xMidYMid slice"
        width="100%"
        height="100%"
      >
        {/* Generic illustrative coastline — not a real place or the user's route. */}
        <Path
          d="M-10,40 Q60,20 120,45 Q165,65 170,110 Q172,150 140,175 Q110,200 70,195 Q30,190 5,160 Q-15,120 -10,40Z"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1.5"
        />
        <Path
          d="M215,30 Q280,10 350,35 Q410,60 410,120 Q405,175 360,200 Q320,220 290,260 Q270,300 230,310 L200,310 Q215,260 235,225 Q250,195 230,165 Q205,130 205,90 Q205,50 215,30Z"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1.5"
        />
        <Path
          d="M60,245 Q100,230 140,248 Q165,262 150,285 Q130,305 90,300 Q55,292 50,270 Q48,255 60,245Z"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1.5"
        />
        <Ellipse
          cx="185"
          cy="215"
          rx="9"
          ry="4"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1"
        />
        <Ellipse
          cx="175"
          cy="235"
          rx="5"
          ry="3"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1"
        />

        {/* Roads */}
        <Path
          d="M30,80 Q80,100 120,90 Q150,120 130,160"
          stroke={roadColor}
          strokeWidth="1"
          fill="none"
        />
        <Path
          d="M240,70 Q300,90 360,80"
          stroke={roadColor}
          strokeWidth="1"
          fill="none"
        />
        <Path
          d="M260,120 Q320,140 340,190"
          stroke={roadColor}
          strokeWidth="1"
          fill="none"
        />

        {/* Grid */}
        {[0, 1, 2, 3, 4].map((i) => (
          <Line
            key={`h${i}`}
            x1="0"
            x2="400"
            y1={i * 60 + 20}
            y2={i * 60 + 20}
            stroke={gridColor}
            strokeDasharray="1 4"
          />
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Line
            key={`v${i}`}
            x1={i * 60}
            x2={i * 60}
            y1="0"
            y2="300"
            stroke={gridColor}
            strokeDasharray="1 4"
          />
        ))}

        {/* Route */}
        {routeD ? (
          <Path
            d={routeD}
            fill="none"
            stroke={dashed}
            strokeWidth="1.8"
            strokeDasharray="4 4"
            strokeLinecap="round"
          />
        ) : null}
        {route.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r="2" fill={dashed} />
        ))}

        {/* Pins (non-pulse portion) */}
        {pins.map((pin, i) => (
          <G key={i} x={pin.x} y={pin.y}>
            {pin.type === "user" ? (
              <G>
                <Circle r="10" fill={pin.color || theme.teal} />
                <Circle r="7" fill="#fff" />
                <SvgText
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill={pin.color || theme.teal}
                >
                  {pin.initial || "Y"}
                </SvgText>
              </G>
            ) : pin.type === "stamp" ? (
              <G rotation={pin.rot ?? -10}>
                <Circle
                  r="13"
                  fill="none"
                  stroke={pin.color || theme.stamp}
                  strokeWidth="1.3"
                  strokeDasharray="2 2"
                />
                <SvgText
                  x="0"
                  y="1"
                  textAnchor="middle"
                  fontSize="6"
                  fontWeight="700"
                  fill={pin.color || theme.stamp}
                >
                  {pin.label}
                </SvgText>
                <SvgText
                  x="0"
                  y="8"
                  textAnchor="middle"
                  fontSize="3.5"
                  fill={pin.color || theme.stamp}
                  opacity="0.7"
                >
                  {pin.sub}
                </SvgText>
              </G>
            ) : (
              <G>
                <Path
                  d="M0,-16 C-6,-16 -8,-12 -8,-8 C-8,-2 0,6 0,6 C0,6 8,-2 8,-8 C8,-12 6,-16 0,-16 Z"
                  fill={pin.color || theme.stamp}
                />
                <Circle r="3" cy="-9" fill="#fff" />
              </G>
            )}
          </G>
        ))}

        {/* Compass rose */}
        <G x="365" y="35" opacity="0.45">
          <Circle
            r="14"
            fill="none"
            stroke={theme.inkMuted}
            strokeWidth="0.8"
          />
          <Path d="M0,-11 L2,0 L0,11 L-2,0Z" fill={theme.inkSoft} />
          <Path
            d="M-11,0 L0,-2 L11,0 L0,2Z"
            fill="none"
            stroke={theme.inkSoft}
            strokeWidth="0.8"
          />
          <SvgText
            x="0"
            y="-16"
            textAnchor="middle"
            fontSize="7"
            fontWeight="700"
            fill={theme.inkSoft}
          >
            N
          </SvgText>
        </G>
      </Svg>

      {/* Pulse rings overlayed in RN (outside SVG so Reanimated can drive them) */}
      {size
        ? pins.map((pin, i) =>
            pin.pulse ? (
              <View
                key={`pulse-${i}`}
                pointerEvents="none"
                style={[
                  styles.pulseAnchor,
                  projectSlice(pin.x, pin.y, size.width - BORDER * 2, size.height - BORDER * 2),
                ]}
              >
                <PulseRing color={pin.color || theme.teal} />
              </View>
            ) : null,
          )
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: BORDER,
  },
  pulseAnchor: {
    position: "absolute",
  },
});
