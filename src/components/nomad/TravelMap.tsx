import React, { useEffect } from "react";
import { View, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
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
        {/* Thailand */}
        <Path
          d="M40,80 Q80,50 130,60 Q170,65 190,90 Q200,120 185,150 Q180,190 200,220 Q210,260 195,290 L170,290 Q165,260 155,240 Q140,220 120,225 Q95,230 80,220 Q55,200 45,170 Q35,130 40,80Z"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1.5"
        />
        {/* Laos/Cambodia */}
        <Path
          d="M195,80 Q240,70 280,80 Q310,95 310,130 Q300,155 280,165 Q250,175 225,170 Q205,165 200,145 Q195,120 195,80Z"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1.5"
        />
        {/* Vietnam */}
        <Path
          d="M310,90 Q335,100 340,140 Q335,190 315,230 Q305,260 290,290 L270,290 Q285,250 295,210 Q302,170 300,140 Q300,110 310,90Z"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1.5"
        />
        {/* Malaysia */}
        <Path
          d="M185,260 Q210,275 230,285 L230,298 L185,298Z"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1.5"
        />
        <Ellipse
          cx="115"
          cy="270"
          rx="10"
          ry="4"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1"
        />
        <Ellipse
          cx="85"
          cy="248"
          rx="5"
          ry="3"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1"
        />
        <Ellipse
          cx="340"
          cy="220"
          rx="7"
          ry="4"
          fill={landFill}
          stroke={landStroke}
          strokeWidth="1"
        />

        {/* Roads */}
        <Path
          d="M100,100 Q150,130 180,180 Q210,220 250,240"
          stroke={roadColor}
          strokeWidth="1"
          fill="none"
        />
        <Path
          d="M80,150 Q120,170 160,170"
          stroke={roadColor}
          strokeWidth="1"
          fill="none"
        />
        <Path
          d="M260,110 Q290,150 300,200"
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
      {pins.map((pin, i) =>
        pin.pulse ? (
          <View
            key={`pulse-${i}`}
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                alignItems: "flex-start",
                justifyContent: "flex-start",
              },
            ]}
          >
            <View
              style={{
                position: "absolute",
                left: `${(pin.x / 400) * 100}%`,
                top: `${(pin.y / 300) * 100}%`,
              }}
            >
              <PulseRing color={pin.color || theme.teal} />
            </View>
          </View>
        ) : null,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
  },
});
