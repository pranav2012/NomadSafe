import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
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

const questionKeys = [
  { q: "onboarding.forecastHanoi", a: "onboarding.forecastHanoiAnswer" },
  { q: "onboarding.splitLisbon", a: "onboarding.splitLisbonAnswer" },
  { q: "onboarding.transitCdg", a: "onboarding.transitCdgAnswer" },
  { q: "onboarding.monthlyFood", a: "onboarding.monthlyFoodAnswer" },
];

const capabilities: { i: IconName; titleKey: string; subKey: string; colorKey: keyof NomadTheme }[] = [
  { i: "trendUp", titleKey: "onboarding.weeklyBriefs", subKey: "onboarding.weeklyBriefsSub", colorKey: "teal" },
  { i: "sparkle", titleKey: "onboarding.askAnything", subKey: "onboarding.askAnythingSub", colorKey: "mustard" },
  { i: "shield", titleKey: "onboarding.zeroTelemetry", subKey: "onboarding.zeroTelemetrySub", colorKey: "stamp" },
];

/**
 * Rotating conic-gradient approximation: four 90° pie slices in the brand
 * colours, spinning continuously. Cross-platform via react-native-svg.
 */
function ConicCore({ teal, mustard, stamp, sky }: { teal: string; mustard: string; stamp: string; sky: string }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(
      withTiming(360, { duration: 9000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [spin]);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  return (
    <Animated.View style={[{ width: 78, height: 78 }, aStyle]}>
      <Svg width={78} height={78} viewBox="0 0 78 78">
        {/* four 90° pie slices forming a full disc */}
        <Path d="M39,39 L39,0 A39,39 0 0,1 78,39 Z" fill={teal} />
        <Path d="M39,39 L78,39 A39,39 0 0,1 39,78 Z" fill={mustard} />
        <Path d="M39,39 L39,78 A39,39 0 0,1 0,39 Z" fill={stamp} />
        <Path d="M39,39 L0,39 A39,39 0 0,1 39,0 Z" fill={sky} />
      </Svg>
    </Animated.View>
  );
}

function PulseRing({ index, color }: { index: number; color: string }) {
  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0);
  useEffect(() => {
    const run = () => {
      scale.value = 0.7;
      opacity.value = 0.7;
      scale.value = withDelay(
        index * 700,
        withRepeat(withTiming(1.4, { duration: 2600, easing: Easing.out(Easing.ease) }), -1, false),
      );
      opacity.value = withDelay(
        index * 700,
        withRepeat(withTiming(0, { duration: 2600, easing: Easing.out(Easing.ease) }), -1, false),
      );
    };
    run();
  }, [scale, opacity, index]);

  const size = 90 + index * 18;
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          left: -size / 2,
          top: -size / 2,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: color,
        },
        aStyle,
      ]}
    />
  );
}

export function AIStep({ theme, totalSteps }: Props) {
  const { t } = useLocalization();
  const [qIdx, setQIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setQIdx((i) => (i + 1) % questionKeys.length), 2600);
    return () => clearInterval(timer);
  }, []);
  const current = questionKeys[qIdx];

  // NO CLOUD pulse
  const cloudPulse = useSharedValue(1);
  useEffect(() => {
    cloudPulse.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 900 }),
        withTiming(1, { duration: 900 }),
      ),
      -1,
      false,
    );
  }, [cloudPulse]);
  const cloudPulseStyle = useAnimatedStyle(() => ({ opacity: cloudPulse.value }));

  return (
    <View style={{ flex: 1 }}>
      {/* HERO */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={styles.hero}>
          <LinearGradient
            colors={["#14110E", "#1F2B28", "#0E1A17"]}
            locations={[0, 0.6, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* faint grid */}
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 280"
            preserveAspectRatio="none"
            style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}
          >
            {Array.from({ length: 14 }).map((_, i) => (
              <Line
                key={`h${i}`}
                x1="0"
                x2="358"
                y1={i * 22}
                y2={i * 22}
                stroke="#fff"
                strokeWidth="0.4"
              />
            ))}
            {Array.from({ length: 18 }).map((_, i) => (
              <Line
                key={`v${i}`}
                x1={i * 22}
                x2={i * 22}
                y1="0"
                y2="280"
                stroke="#fff"
                strokeWidth="0.3"
              />
            ))}
          </Svg>

          {/* NO CLOUD badge */}
          <View style={[styles.noCloud, { borderColor: "rgba(217,164,65,0.25)" }]}>
            <Animated.View
              style={[
                { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.mustard },
                cloudPulseStyle,
              ]}
            />
            <Text style={[styles.noCloudText, { color: theme.mustard }]}>
              {t("onboarding.noCloud")}
            </Text>
          </View>

          {/* Secure Enclave chip badge */}
          <View style={[styles.enclave, { borderColor: "rgba(255,255,255,0.12)" }]}>
            <Icon name="lock" size={9} color="rgba(255,255,255,0.85)" />
            <Text style={styles.enclaveText}>{t("onboarding.secureEnclave")}</Text>
          </View>

          {/* Phone silhouette */}
          <View style={styles.phoneSilhouette}>
            <LinearGradient
              colors={["rgba(255,255,255,0.06)", "rgba(255,255,255,0.02)"]}
              style={[StyleSheet.absoluteFill, { borderRadius: 26 }]}
            />
            {/* Dynamic island */}
            <View style={styles.dynamicIsland} />

            {/* Conic AI core */}
            <View style={styles.core}>
              <ConicCore
                teal={theme.teal}
                mustard={theme.mustard}
                stamp={theme.stamp}
                sky={theme.sky}
              />
              {/* inner dark disc */}
              <View style={styles.coreInner}>
                <Icon name="sparkle" size={18} color={theme.mustard} strokeWidth={1.8} />
              </View>
              {/* pulse rings */}
              <PulseRing index={0} color={theme.mustard} />
              <PulseRing index={1} color={theme.mustard} />
              <PulseRing index={2} color={theme.mustard} />
            </View>
          </View>

          {/* Question pill */}
          <Animated.View
            key={`q-${qIdx}`}
            entering={FadeIn.duration(400)}
            style={[
              styles.qPill,
              { borderColor: "rgba(255,255,255,0.14)" },
            ]}
          >
            <Text style={[styles.qLabel, { color: theme.mustard }]}>{t("onboarding.you")}</Text>
            <Text style={[styles.qText, { color: "rgba(255,255,255,0.9)" }]}>
              {t(current.q)}
            </Text>
          </Animated.View>

          {/* Answer pill */}
          <Animated.View
            key={`a-${qIdx}`}
            entering={FadeInDown.delay(200).duration(400)}
            style={[
              styles.aPill,
              { backgroundColor: theme.mustard },
            ]}
          >
            <Text style={[styles.aLabel, { color: theme.stamp }]}>
              {t("onboarding.onDevice")}
            </Text>
            <Text style={[styles.aText, { color: theme.inkDeep }]}>
              {t(current.a)}
            </Text>
          </Animated.View>

          {/* Connecting dotted paths */}
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 280"
            preserveAspectRatio="none"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            <Path
              d="M132,116 Q170,140 156,154"
              fill="none"
              stroke={theme.mustard}
              strokeWidth="1"
              strokeDasharray="2 3"
              opacity="0.55"
            />
            <Path
              d="M200,156 Q226,178 226,192"
              fill="none"
              stroke={theme.mustard}
              strokeWidth="1"
              strokeDasharray="2 3"
              opacity="0.55"
            />
          </Svg>

          {/* Bottom row: chip + data-out meter */}
          <View style={styles.bottomRow}>
            <View style={[styles.chipMotif, { borderColor: "rgba(255,255,255,0.1)" }]}>
              <Svg width={20} height={20} viewBox="0 0 20 20">
                <Rect
                  x="4"
                  y="4"
                  width="12"
                  height="12"
                  rx="2"
                  fill="none"
                  stroke={theme.teal}
                  strokeWidth="1.2"
                />
                <Rect
                  x="7"
                  y="7"
                  width="6"
                  height="6"
                  rx="1"
                  fill={theme.teal}
                  opacity="0.4"
                />
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`t${i}`}
                    x1={5.5 + i * 3}
                    y1="0"
                    x2={5.5 + i * 3}
                    y2="4"
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`b${i}`}
                    x1={5.5 + i * 3}
                    y1="16"
                    x2={5.5 + i * 3}
                    y2="20"
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`l${i}`}
                    x1="0"
                    y1={5.5 + i * 3}
                    x2="4"
                    y2={5.5 + i * 3}
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`r${i}`}
                    x1="16"
                    y1={5.5 + i * 3}
                    x2="20"
                    y2={5.5 + i * 3}
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
              </Svg>
              <View style={{ marginLeft: 8 }}>
                <Text style={styles.chipTitle}>{t("onboarding.neuralEngine")}</Text>
                <Text style={styles.chipSub}>{t("onboarding.modelSize")}</Text>
              </View>
            </View>

            <View style={[styles.outMeter, { borderColor: "rgba(198,67,42,0.28)" }]}>
              <Icon name="wifi" size={10} color="#F4B2A1" />
              <Text style={styles.outMeterText}>{t("onboarding.outZero")}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Headline */}
      <View style={{ paddingHorizontal: 26, paddingTop: 22 }}>
        <Eyebrow color={theme.sky}>
          {t("onboarding.stepOf", { step: 3, total: totalSteps - 1 })}
        </Eyebrow>
        <HugeHeadline color={theme.inkDeep}>
          {t("onboarding.aiHeadlinePrefix")}{" "}
          <HeadlineItalic>{t("onboarding.aiHeadlineAccent")}</HeadlineItalic>.
        </HugeHeadline>
        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          {t("onboarding.aiLede")}
        </Text>
      </View>

      {/* Comparison row */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18, flexDirection: "row", gap: 8 }}>
        {/* Cloud card */}
        <View
          style={[
            styles.compCell,
            { backgroundColor: theme.paperSoft, borderColor: theme.hairline, opacity: 0.72 },
          ]}
        >
          <Text style={[styles.compEyebrow, { color: theme.inkMuted }]}>
            {t("onboarding.cloudAi")}
          </Text>
          <Text style={[styles.compTitle, { color: theme.inkDeep }]}>
            {t("onboarding.yourDataLeaves")}
          </Text>
          <Text style={[styles.compSub, { color: theme.inkSoft }]}>
            {t("onboarding.cloudAiSub")}
          </Text>
          <View style={[styles.compBar, { backgroundColor: theme.hairline }]}>
            <View style={[styles.compBarFill, { backgroundColor: theme.stamp, width: "30%" }]} />
          </View>
          <View style={[styles.compDot, { backgroundColor: theme.stamp + "22" }]}>
            <Icon name="x" size={8} color={theme.stamp} strokeWidth={3} />
          </View>
        </View>

        {/* On-device card */}
        <View
          style={[
            styles.compCell,
            { backgroundColor: theme.inkDeep, borderColor: theme.inkDeep },
          ]}
        >
          <Text style={[styles.compEyebrow, { color: theme.mustard }]}>
            {t("onboarding.onDevice")}
          </Text>
          <Text style={[styles.compTitleDark, { color: theme.paperSoft }]}>
            {t("onboarding.staysWithYou")}
          </Text>
          <Text style={[styles.compSub, { color: "rgba(245,240,232,0.65)" }]}>
            {t("onboarding.onDeviceSub")}
          </Text>
          <View style={[styles.compBar, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <Animated.View
              style={[
                { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: theme.mustard, borderRadius: 2 },
                cloudPulseStyle,
              ]}
            />
          </View>
          <View style={[styles.compDot, { backgroundColor: theme.mustard }]}>
            <Icon name="check" size={8} color={theme.inkDeep} strokeWidth={3} />
          </View>
        </View>
      </View>

      {/* Capability rows */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 8 }}>
        {capabilities.map((f, i) => {
          const fColor = theme[f.colorKey] as string;
          return (
            <View
              key={i}
              style={[
                styles.capRow,
                { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
              ]}
            >
              <View style={[styles.capIcon, { backgroundColor: fColor + "22" }]}>
                <Icon name={f.i} size={15} color={fColor} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.capTitle, { color: theme.inkDeep }]}>{t(f.titleKey)}</Text>
                <Text style={[styles.capSub, { color: theme.inkSoft }]}>{t(f.subKey)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Download estimator */}
      <View
        style={{
          paddingHorizontal: 26,
          paddingTop: 14,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={[styles.estText, { color: theme.inkMuted }]}>
          {t("onboarding.downloadEstimate")}
        </Text>
        <Text style={[styles.estText, { color: theme.inkMuted }]}>
          {t("onboarding.skipCloudLater")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 280,
    borderRadius: 22,
    position: "relative",
    overflow: "hidden",
  },
  noCloud: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(217,164,65,0.14)",
    borderWidth: 1,
  },
  noCloudText: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1.4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  enclave: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  enclaveText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 9.5,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 1,
  },
  phoneSilhouette: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -58,
    marginTop: -96,
    width: 116,
    height: 192,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  dynamicIsland: {
    position: "absolute",
    top: 8,
    left: "50%",
    marginLeft: -21,
    width: 42,
    height: 12,
    borderRadius: 999,
    backgroundColor: "#000",
  },
  core: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -39,
    marginTop: -39,
    width: 78,
    height: 78,
    alignItems: "center",
    justifyContent: "center",
  },
  coreInner: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  qPill: {
    position: "absolute",
    left: 14,
    top: 98,
    maxWidth: 118,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  qLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 3,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  qText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    fontFamily: NOMAD_FONTS.uiMedium,
  },
  aPill: {
    position: "absolute",
    right: 14,
    bottom: 82,
    maxWidth: 128,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 12,
    shadowColor: "#D9A441",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  aLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 3,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  aText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  bottomRow: {
    position: "absolute",
    bottom: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  chipMotif: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
  },
  chipTitle: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.6,
    fontFamily: NOMAD_FONTS.mono,
  },
  chipSub: {
    fontSize: 8.5,
    color: "rgba(255,255,255,0.5)",
    fontFamily: NOMAD_FONTS.mono,
    marginTop: 1,
  },
  outMeter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(198,67,42,0.15)",
    borderWidth: 1,
  },
  outMeterText: {
    color: "#F4B2A1",
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    fontWeight: "600",
  },
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
  },
  compCell: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    position: "relative",
    minHeight: 86,
  },
  compEyebrow: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  compTitle: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  compTitleDark: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  compSub: {
    fontSize: 10.5,
    marginTop: 3,
    lineHeight: 14,
    fontFamily: NOMAD_FONTS.ui,
  },
  compBar: {
    marginTop: 8,
    height: 4,
    borderRadius: 2,
    position: "relative",
    overflow: "hidden",
  },
  compBarFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 2,
  },
  compDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  capRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  capIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  capTitle: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  capSub: {
    fontSize: 11.5,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
  estText: {
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.3,
  },
});
