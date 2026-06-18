import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, Path, Line } from "react-native-svg";
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
import { useLocalization } from "@/localization";
import type { BiometricPresentation } from "@/hooks/useBiometricPresentation";
import { PermissionRow } from "../PermissionRow";
import { Eyebrow, HugeHeadline, HeadlineItalic } from "../Typography";

interface Props {
  theme: NomadTheme;
  totalSteps: number;
  biometric: BiometricPresentation;
}

export function SecureStep({ theme, totalSteps, biometric }: Props) {
  const { t } = useLocalization();
  // scan-line animation
  const y = useSharedValue(-22);
  const op = useSharedValue(0);

  useEffect(() => {
    y.value = withRepeat(
      withSequence(
        withTiming(-22, { duration: 0 }),
        withTiming(22, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(-22, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    op.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 0 }),
        withTiming(1, { duration: 480 }),
        withTiming(1, { duration: 1440 }),
        withTiming(0, { duration: 480 }),
      ),
      -1,
      false,
    );
  }, [y, op]);

  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: op.value,
  }));

  const bracket = {
    width: 20,
    height: 20,
    position: "absolute" as const,
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 26, paddingTop: 20, alignItems: "center" }}>
        <View style={styles.faceBox}>
          <LinearGradient
            colors={[theme.inkDeep, "#2A332E"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 34 }]}
          />

          {/* Corner brackets */}
          <View
            style={[
              bracket,
              {
                top: 16,
                left: 16,
                borderTopWidth: 2,
                borderLeftWidth: 2,
                borderTopLeftRadius: 6,
                borderColor: theme.mustard,
              },
            ]}
          />
          <View
            style={[
              bracket,
              {
                top: 16,
                right: 16,
                borderTopWidth: 2,
                borderRightWidth: 2,
                borderTopRightRadius: 6,
                borderColor: theme.mustard,
              },
            ]}
          />
          <View
            style={[
              bracket,
              {
                bottom: 16,
                left: 16,
                borderBottomWidth: 2,
                borderLeftWidth: 2,
                borderBottomLeftRadius: 6,
                borderColor: theme.mustard,
              },
            ]}
          />
          <View
            style={[
              bracket,
              {
                bottom: 16,
                right: 16,
                borderBottomWidth: 2,
                borderRightWidth: 2,
                borderBottomRightRadius: 6,
                borderColor: theme.mustard,
              },
            ]}
          />

          <BiometricGlyph type={biometric.kind} color={theme.paperSoft} />

          {/* Scan line */}
          <Animated.View
            style={[
              {
                position: "absolute",
                left: 16,
                right: 16,
                top: 68,
                height: 2,
                borderRadius: 1,
                overflow: "hidden",
              },
              scanStyle,
            ]}
          >
            <LinearGradient
              colors={["transparent", theme.mustard, "transparent"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        <View style={{ marginTop: 22, alignSelf: "stretch", alignItems: "flex-start" }}>
          <Eyebrow color={theme.sky}>
            {t("onboarding.stepOf", { step: 5, total: totalSteps - 1 })}
          </Eyebrow>
          <HugeHeadline color={theme.inkDeep}>
            {t("onboarding.secureHeadlinePrefix")}{" "}
            <HeadlineItalic>{biometric.protectedBy}</HeadlineItalic>.
          </HugeHeadline>
        </View>

        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          {t("onboarding.secureLede", {
            biometricName: biometric.name,
            keyStoreName: biometric.keyStoreName,
          })}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 18, gap: 8 }}>
        <PermissionRow theme={theme} title={biometric.name} sub={t("onboarding.unlockVault")} on />
        <PermissionRow theme={theme} title={biometric.keyStoreName} sub={t("onboarding.keysStayOnDevice")} on />
        <PermissionRow theme={theme} title={t("onboarding.autoLock")} sub={t("onboarding.afterThirtySeconds")} on />
      </View>
    </View>
  );
}

function BiometricGlyph({ type, color }: { type: "face" | "fingerprint" | "generic"; color: string }) {
  if (type === "fingerprint") {
    return (
      <Svg width={140} height={140} viewBox="0 0 140 140" style={StyleSheet.absoluteFill}>
        <Path d="M47 68c0-13 10-23 23-23s23 10 23 23" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
        <Path d="M40 65c2-18 15-31 30-31 17 0 30 13 30 31" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" opacity="0.82" />
        <Path d="M53 73c0-10 7-17 17-17s17 7 17 17c0 18-7 28-18 36" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
        <Path d="M67 72c0-3 1.5-5 3-5s3 2 3 5c0 17-7 26-18 32" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
        <Path d="M87 94c3-7 5-14 5-22" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" opacity="0.82" />
        <Path d="M50 91c-2-5-3-11-3-18" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" opacity="0.82" />
      </Svg>
    );
  }

  return (
    <Svg width={140} height={140} viewBox="0 0 140 140" style={StyleSheet.absoluteFill}>
      <Circle cx="56" cy="62" r="3" fill={color} />
      <Circle cx="84" cy="62" r="3" fill={color} />
      <Path
        d="M56,90 Q70,98 84,90"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Line
        x1="70"
        y1="66"
        x2="70"
        y2="80"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.6"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  faceBox: {
    width: 140,
    height: 140,
    borderRadius: 34,
    marginTop: 6,
    position: "relative",
    overflow: "hidden",
    shadowColor: "#1A1612",
    shadowOpacity: 0.18,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
    alignSelf: "stretch",
    textAlign: "left",
  },
});
