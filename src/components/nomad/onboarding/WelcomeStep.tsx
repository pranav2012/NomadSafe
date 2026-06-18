import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeIn,
  FadeInDown,
  ZoomIn,
} from "react-native-reanimated";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { Stamp } from "../Stamp";
import { Icon } from "../Icon";
import { Eyebrow, HugeHeadline, HeadlineItalic } from "../Typography";

interface Props {
  theme: NomadTheme;
}

const HERO_H = 300;

export function WelcomeStep({ theme }: Props) {
  return (
    <View style={{ flex: 1 }}>
      {/* HERO */}
      <View style={{ height: HERO_H, overflow: "hidden", position: "relative" }}>
        <LinearGradient
          colors={[theme.stampSoft, theme.paper]}
          locations={[0, 0.65]}
          start={{ x: 0.6, y: 0.4 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* faint world-map lines */}
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 390 ${HERO_H}`}
          preserveAspectRatio="none"
          style={[StyleSheet.absoluteFill, { opacity: 0.24 }]}
        >
          {Array.from({ length: 14 }).map((_, i) => (
            <Path
              key={i}
              d={`M-20,${20 + i * 22} Q100,${10 + i * 20} 200,${25 + i * 22} T420,${30 + i * 21}`}
              fill="none"
              stroke={theme.inkMuted}
              strokeWidth="0.6"
              strokeDasharray={i % 3 === 0 ? "0" : "2 3"}
            />
          ))}
          <Path
            d="M40,220 Q195,90 340,220"
            fill="none"
            stroke={theme.stamp}
            strokeWidth="1"
            strokeDasharray="3 4"
            opacity="0.35"
          />
          <Path
            d="M60,80 Q195,240 340,80"
            fill="none"
            stroke={theme.stamp}
            strokeWidth="1"
            strokeDasharray="3 4"
            opacity="0.35"
          />
        </Svg>

        {/* three stamps */}
        <Animated.View
          entering={ZoomIn.delay(100).duration(600).springify().damping(10)}
          style={[styles.stampTKO]}
        >
          <Stamp label="TKO" sub="APR 2024" color={theme.teal} rot={-14} size={82} />
        </Animated.View>

        <Animated.View
          entering={ZoomIn.delay(300).duration(600).springify().damping(10)}
          style={[styles.stampLIS]}
        >
          <Stamp label="LIS" sub="JUL 2024" color={theme.mustard} rot={14} size={80} />
        </Animated.View>

        <Animated.View
          entering={ZoomIn.delay(500).duration(600).springify().damping(10)}
          style={[styles.stampSEA]}
        >
          <Stamp label="SEA" sub="MAR 2025" color={theme.stamp} rot={-4} size={124} />
        </Animated.View>

        {/* connecting dashed arcs */}
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 390 ${HERO_H}`}
          preserveAspectRatio="none"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Path
            d="M70,85 Q195,20 320,95"
            fill="none"
            stroke={theme.stamp}
            strokeWidth="1.2"
            strokeDasharray="3 4"
            opacity="0.45"
          />
          <Path
            d="M90,135 Q195,230 300,135"
            fill="none"
            stroke={theme.inkMuted}
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.3"
          />
        </Svg>

        {/* shield glyph */}
        <Animated.View
          entering={FadeIn.delay(700).duration(400)}
          style={[
            styles.shieldBadge,
            {
              backgroundColor: theme.inkDeep,
              shadowColor: "#1A1612",
            },
          ]}
        >
          <Icon name="shield" size={22} color={theme.mustard} strokeWidth={2} />
        </Animated.View>
      </View>

      {/* COPY */}
      <Animated.View
        entering={FadeInDown.delay(200).duration(500)}
        style={styles.copyWrap}
      >
        <Eyebrow color={theme.stamp}>Nomad Safe · v2.4</Eyebrow>
        <HugeHeadline color={theme.inkDeep}>
          Travel,{" "}
          <HeadlineItalic color={theme.stamp}>guarded</HeadlineItalic>.
        </HugeHeadline>
        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          A safety companion for long trips — check-ins, sharing, and money, all
          on your phone. Nothing on our servers, ever.
        </Text>

        {/* KPI row */}
        <View
          style={[
            styles.kpiRow,
            { borderTopColor: theme.hairline },
          ]}
        >
          {[
            { v: "140k", l: "Travellers" },
            { v: "4.9★", l: "App Store" },
            { v: "0", l: "Servers" },
          ].map((kpi, i) => (
            <View key={i} style={{ flex: 1 }}>
              <Text
                style={[
                  styles.kpiValue,
                  { color: theme.inkDeep },
                ]}
              >
                {kpi.v}
              </Text>
              <Text style={[styles.kpiLabel, { color: theme.inkMuted }]}>
                {kpi.l}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stampTKO: { position: "absolute", left: 28, top: 42 },
  stampLIS: { position: "absolute", right: 34, top: 54 },
  stampSEA: {
    position: "absolute",
    left: "50%",
    bottom: 18,
    marginLeft: -62,
  },
  shieldBadge: {
    position: "absolute",
    right: 18,
    top: 22,
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-6deg" }],
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  copyWrap: {
    paddingHorizontal: 26,
    paddingTop: 28,
  },
  lede: {
    fontSize: 15,
    marginTop: 12,
    lineHeight: 15 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
  },
  kpiRow: {
    flexDirection: "row",
    gap: 18,
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
  kpiValue: {
    fontFamily: NOMAD_FONTS.display,
    fontWeight: "500",
    fontSize: 22,
    letterSpacing: -0.4,
    lineHeight: 22,
  },
  kpiLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: "600",
    textTransform: "uppercase",
    marginTop: 4,
    fontFamily: NOMAD_FONTS.uiSemi,
  },
});
