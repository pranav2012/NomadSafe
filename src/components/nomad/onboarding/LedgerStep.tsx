import React, { useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Line } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { Icon, type IconName } from "../Icon";
import {
  Eyebrow,
  HugeHeadline,
  HeadlineItalic,
} from "../Typography";

interface Props {
  theme: NomadTheme;
  totalSteps: number;
}

type Bank = {
  id: string;
  name: string;
  sub: string;
  colorKey: keyof NomadTheme;
};

const banks: Bank[] = [
  { id: "revolut", name: "Revolut", sub: "Multi-currency · FX", colorKey: "inkDeep" },
  { id: "wise", name: "Wise", sub: "Debit · global", colorKey: "teal" },
  { id: "chase", name: "Chase", sub: "Travel credit", colorKey: "sky" },
  { id: "amex", name: "Amex Platinum", sub: "Points · lounges", colorKey: "mustard" },
];

const features: { i: IconName; t: string; s: string; colorKey: keyof NomadTheme }[] = [
  { i: "users", t: "Group split", s: "Auto-split meals, stays, rides with co-travellers", colorKey: "teal" },
  { i: "trendUp", t: "Interbank FX", s: "Real-time conversion, no hidden spread", colorKey: "mustard" },
  { i: "wallet", t: "Category budgets", s: "Food, transit, stays — roll over automatically", colorKey: "stamp" },
];

export function LedgerStep({ theme, totalSteps }: Props) {
  const [connected, setConnected] = useState<string[]>(["revolut"]);
  const toggle = (id: string) =>
    setConnected((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  // auto-sync pulse dot
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={{ flex: 1 }}>
      {/* HERO: stacked cards */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={styles.hero}>
          <LinearGradient
            colors={[theme.inkDeep, "#2A332E"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 210"
            preserveAspectRatio="none"
            style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}
          >
            {Array.from({ length: 10 }).map((_, i) => (
              <Line
                key={i}
                x1="0"
                x2="358"
                y1={i * 22}
                y2={i * 22}
                stroke={theme.paperSoft}
                strokeWidth="0.4"
              />
            ))}
          </Svg>

          {/* Card 1 back (Wise) */}
          <View style={[styles.cardBack]}>
            <LinearGradient
              colors={[theme.teal, "#1F4C43"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.cardBrand}>WISE</Text>
            <Text style={styles.cardNum}>•••• 4182</Text>
            <View style={styles.cardChip} />
          </View>

          {/* Card 2 front (Revolut) */}
          <View style={[styles.cardFront]}>
            <LinearGradient
              colors={[theme.stamp, "#8B2F1E"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.cardBrandFront}>REVOLUT</Text>
            <Text style={styles.cardEmoji}>💳</Text>
            <Text style={styles.cardNumFront}>•••• •••• 2097</Text>
            <Text style={styles.cardHolder}>A. KOVÁCS</Text>
            <Text style={[styles.cardBalance, { fontFamily: NOMAD_FONTS.display }]}>
              £412
            </Text>
          </View>

          {/* auto-sync badge */}
          <View style={[styles.autoSync, { backgroundColor: "rgba(43,108,95,0.25)" }]}>
            <Animated.View
              style={[
                { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.teal },
                pulseStyle,
              ]}
            />
            <Text style={[styles.autoSyncText, { color: theme.tealSoft }]}>
              AUTO-SYNC · OPEN BANKING
            </Text>
          </View>
        </View>
      </View>

      {/* Headline */}
      <View style={{ paddingHorizontal: 26, paddingTop: 22 }}>
        <Eyebrow color={theme.mustard}>Step 4 of {totalSteps - 1}</Eyebrow>
        <HugeHeadline color={theme.inkDeep}>
          Trips & <HeadlineItalic>money</HeadlineItalic>, auto-tracked.
        </HugeHeadline>
        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          Connect cards via Open Banking — spend gets categorised, split with companions, and converted at interbank FX. Zero manual entry.
        </Text>
      </View>

      {/* Bank picker */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <Text
          style={[
            styles.pickerLabel,
            { color: theme.inkMuted, fontFamily: NOMAD_FONTS.uiBold },
          ]}
        >
          Connect accounts · {connected.length} linked
        </Text>
        <View style={styles.bankGrid}>
          {banks.map((b) => {
            const on = connected.includes(b.id);
            const bColor = theme[b.colorKey] as string;
            return (
              <Pressable
                key={b.id}
                onPress={() => toggle(b.id)}
                style={[
                  styles.bankCell,
                  {
                    backgroundColor: on ? theme.paperSoft : "transparent",
                    borderColor: on ? bColor : theme.hairline,
                  },
                ]}
              >
                <View style={[styles.bankBadge, { backgroundColor: bColor }]}>
                  <Text style={styles.bankBadgeText}>{b.name.slice(0, 1)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={[styles.bankName, { color: theme.inkDeep }]}
                  >
                    {b.name}
                  </Text>
                  <Text style={[styles.bankSub, { color: theme.inkSoft }]}>
                    {b.sub}
                  </Text>
                </View>
                <View
                  style={[
                    styles.bankCheck,
                    {
                      borderColor: on ? bColor : theme.hairline,
                      backgroundColor: on ? bColor : "transparent",
                    },
                  ]}
                >
                  {on ? (
                    <Icon name="check" size={10} color="#fff" strokeWidth={3} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Feature strip */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18, gap: 8 }}>
        {features.map((f, i) => {
          const fColor = theme[f.colorKey] as string;
          return (
            <View
              key={i}
              style={[
                styles.featureRow,
                {
                  backgroundColor: theme.paperSoft,
                  borderColor: theme.hairline,
                },
              ]}
            >
              <View
                style={[
                  styles.featureIcon,
                  { backgroundColor: fColor + "22" },
                ]}
              >
                <Icon name={f.i} size={15} color={fColor} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.featureTitle, { color: theme.inkDeep }]}>
                  {f.t}
                </Text>
                <Text style={[styles.featureSub, { color: theme.inkSoft }]}>
                  {f.s}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 210,
    borderRadius: 20,
    position: "relative",
    overflow: "hidden",
  },
  cardBack: {
    position: "absolute",
    left: 28,
    top: 52,
    width: 180,
    height: 108,
    borderRadius: 14,
    overflow: "hidden",
    transform: [{ rotate: "-8deg" }],
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  cardFront: {
    position: "absolute",
    right: 22,
    top: 40,
    width: 190,
    height: 116,
    borderRadius: 14,
    overflow: "hidden",
    transform: [{ rotate: "6deg" }],
    shadowColor: "#C6432A",
    shadowOpacity: 0.45,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
  },
  cardBrand: {
    position: "absolute",
    left: 12,
    top: 10,
    fontSize: 9,
    opacity: 0.7,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  cardBrandFront: {
    position: "absolute",
    left: 14,
    top: 12,
    fontSize: 10,
    opacity: 0.8,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  cardNum: {
    position: "absolute",
    left: 12,
    bottom: 12,
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 11,
    opacity: 0.85,
    letterSpacing: 1.2,
    color: "#fff",
  },
  cardNumFront: {
    position: "absolute",
    left: 14,
    bottom: 34,
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 12,
    opacity: 0.9,
    letterSpacing: 1.4,
    color: "#fff",
  },
  cardChip: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 16,
    height: 12,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  cardEmoji: {
    position: "absolute",
    right: 14,
    top: 12,
    fontSize: 18,
  },
  cardHolder: {
    position: "absolute",
    left: 14,
    bottom: 12,
    fontSize: 9,
    opacity: 0.7,
    letterSpacing: 0.5,
    color: "#fff",
    fontFamily: NOMAD_FONTS.ui,
  },
  cardBalance: {
    position: "absolute",
    right: 14,
    bottom: 10,
    fontSize: 18,
    fontWeight: "500",
    color: "#fff",
  },
  autoSync: {
    position: "absolute",
    left: 16,
    top: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  autoSyncText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
  },
  pickerLabel: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
    paddingLeft: 6,
  },
  bankGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bankCell: {
    width: "48.5%",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bankBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  bankBadgeText: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 12,
  },
  bankName: {
    fontSize: 12.5,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  bankSub: {
    fontSize: 10,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
  bankCheck: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  featureRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  featureSub: {
    fontSize: 11.5,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
});
