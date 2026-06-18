import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  FadeIn,
} from "react-native-reanimated";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon, type IconName } from "../Icon";
import { PermissionRow } from "../PermissionRow";
import { Eyebrow, HugeHeadline, HeadlineItalic } from "../Typography";

interface Props {
  theme: NomadTheme;
  totalSteps: number;
}

const features: { i: IconName; titleKey: string; subKey: string; colorKey: keyof NomadTheme }[] = [
  { i: "users", titleKey: "onboarding.groupSplit", subKey: "onboarding.groupSplitSub", colorKey: "teal" },
  { i: "trendUp", titleKey: "onboarding.interbankFx", subKey: "onboarding.interbankFxSub", colorKey: "mustard" },
  { i: "wallet", titleKey: "onboarding.categoryBudgets", subKey: "onboarding.categoryBudgetsSub", colorKey: "stamp" },
];

export function LedgerStep({ theme, totalSteps }: Props) {
  const { t } = useLocalization();
  // parsing pulse dot
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={{ flex: 1 }}>
      {/* HERO: email + SMS → auto-logged spend */}
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
            viewBox="0 0 358 230"
            preserveAspectRatio="none"
            style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}
          >
            {Array.from({ length: 11 }).map((_, i) => (
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

          {/* badges */}
          <View style={[styles.parsedBadge, { borderColor: "rgba(217,164,65,0.25)" }]}>
            <Animated.View
              style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: theme.mustard }, pulseStyle]}
            />
            <Text style={[styles.parsedText, { color: theme.mustard }]}>
              {t("onboarding.parsedOnDevice")}
            </Text>
          </View>
          <View style={[styles.uploadBadge, { borderColor: "rgba(255,255,255,0.12)" }]}>
            <Icon name="lock" size={9} color="rgba(255,255,255,0.85)" />
            <Text style={styles.uploadText}>{t("onboarding.neverUploaded")}</Text>
          </View>

          {/* converging arrows */}
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 230"
            preserveAspectRatio="none"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            <Path d="M96,116 Q120,160 176,182" fill="none" stroke={theme.mustard} strokeWidth="1.2" strokeDasharray="2 3" opacity="0.6" />
            <Path d="M262,116 Q238,160 182,182" fill="none" stroke={theme.sky} strokeWidth="1.2" strokeDasharray="2 3" opacity="0.6" />
          </Svg>

          {/* SMS card */}
          <Animated.View entering={FadeIn.duration(500)} style={[styles.msgCard, styles.smsCard]}>
            <View style={styles.msgHead}>
              <View style={[styles.msgIcon, { backgroundColor: theme.mustard }]}>
                <Icon name="phone" size={10} color={theme.inkDeep} />
              </View>
              <Text style={[styles.msgTag, { color: theme.mustard }]}>
                {t("onboarding.smsHdfc")}
              </Text>
            </View>
            <Text style={styles.msgBody}>
              {t("onboarding.smsReceipt")}
            </Text>
          </Animated.View>

          {/* EMAIL card */}
          <Animated.View entering={FadeIn.delay(120).duration(500)} style={[styles.msgCard, styles.emailCard]}>
            <View style={styles.msgHead}>
              <View style={[styles.msgIcon, { backgroundColor: theme.sky }]}>
                <Icon name="mail" size={11} color="#fff" />
              </View>
              <Text style={[styles.msgTag, { color: theme.sky }]}>
                {t("onboarding.emailUber")}
              </Text>
            </View>
            <Text style={styles.msgBody}>
              {t("onboarding.emailReceipt")}
            </Text>
          </Animated.View>

          {/* result ledger chip */}
          <View style={[styles.loggedChip, { backgroundColor: theme.teal, shadowColor: theme.teal }]}>
            <View style={styles.loggedCheck}>
              <Icon name="check" size={11} color="#fff" strokeWidth={3} />
            </View>
            <Text style={styles.loggedLabel}>{t("onboarding.logged")}</Text>
            <Text style={styles.loggedMeta}>{t("onboarding.loggedMeta")}</Text>
          </View>
        </View>
      </View>

      {/* Headline */}
      <View style={{ paddingHorizontal: 26, paddingTop: 22 }}>
        <Eyebrow color={theme.mustard}>
          {t("onboarding.stepOf", { step: 4, total: totalSteps - 1 })}
        </Eyebrow>
        <HugeHeadline color={theme.inkDeep}>
          {t("onboarding.ledgerHeadlinePrefix")}{" "}
          <HeadlineItalic>{t("onboarding.ledgerHeadlineAccent")}</HeadlineItalic>.
        </HugeHeadline>
        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          {t("onboarding.ledgerLede")}
        </Text>
      </View>

      {/* Grant access */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
        <Text style={[styles.grantLabel, { color: theme.inkMuted }]}>
          {t("onboarding.grantAccess")}
        </Text>
        <View style={{ gap: 8 }}>
          <PermissionRow
            theme={theme}
            title={t("onboarding.emailTransactionsOnly")}
            sub={t("onboarding.readsReceipts")}
            on
          />
          <PermissionRow
            theme={theme}
            title={t("onboarding.smsSpendAlerts")}
            sub={t("onboarding.bankDebitAlerts")}
            on
          />
        </View>
      </View>

      {/* Feature strip */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18, gap: 8 }}>
        {features.map((f, i) => {
          const fColor = theme[f.colorKey] as string;
          return (
            <View
              key={i}
              style={[styles.featureRow, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}
            >
              <View style={[styles.featureIcon, { backgroundColor: fColor + "22" }]}>
                <Icon name={f.i} size={15} color={fColor} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.featureTitle, { color: theme.inkDeep }]}>{t(f.titleKey)}</Text>
                <Text style={[styles.featureSub, { color: theme.inkSoft }]}>{t(f.subKey)}</Text>
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
    height: 230,
    borderRadius: 20,
    position: "relative",
    overflow: "hidden",
  },
  parsedBadge: {
    position: "absolute",
    left: 14,
    top: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(217,164,65,0.16)",
    borderWidth: 1,
  },
  parsedText: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  uploadBadge: {
    position: "absolute",
    right: 14,
    top: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  uploadText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 9.5,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.6,
  },
  msgCard: {
    position: "absolute",
    top: 52,
    width: 156,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },
  smsCard: { left: 18 },
  emailCard: { right: 18 },
  msgHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  msgIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  msgTag: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  msgBody: {
    fontSize: 10.5,
    lineHeight: 10.5 * 1.35,
    color: "rgba(255,255,255,0.9)",
    fontFamily: NOMAD_FONTS.ui,
  },
  msgBold: { fontFamily: NOMAD_FONTS.uiSemi, fontWeight: "700" },
  loggedChip: {
    position: "absolute",
    bottom: 18,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 15,
    borderRadius: 999,
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  loggedCheck: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  loggedLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  loggedMeta: {
    fontSize: 11,
    opacity: 0.8,
    color: "#fff",
    fontFamily: NOMAD_FONTS.mono,
  },
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
  },
  grantLabel: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
    paddingLeft: 6,
    fontFamily: NOMAD_FONTS.uiBold,
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
