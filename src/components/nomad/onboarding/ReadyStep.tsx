import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import type { BiometricPresentation } from "@/hooks/useBiometricPresentation";
import { useLocalization } from "@/localization";
import { Stamp } from "../Stamp";
import { Icon, type IconName } from "../Icon";
import {
  Eyebrow,
  HugeHeadline,
  HeadlineItalic,
} from "../Typography";

interface Props {
  theme: NomadTheme;
  selectedContactsCount: number;
  biometric: BiometricPresentation;
}

export function ReadyStep({ theme, selectedContactsCount, biometric }: Props) {
  const { t } = useLocalization();
  const rows: { i: IconName; l: string; v: string; c: string }[] = [
    { i: "mapPin", l: t("onboarding.location"), v: t("onboarding.locationValue"), c: theme.teal },
    {
      i: "users",
      l: t("onboarding.trustedThreeLabel"),
      v: t("onboarding.people", { count: selectedContactsCount }),
      c: theme.mustard,
    },
    { i: "wifi", l: t("onboarding.offlineFallback"), v: t("onboarding.offlineFallbackValue"), c: theme.stamp },
    { i: "lock", l: t("onboarding.vault"), v: biometric.vaultSummary, c: theme.sky },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 26, paddingTop: 20, alignItems: "center" }}>
        <Animated.View
          entering={ZoomIn.duration(800).springify().damping(10)}
          style={{ marginBottom: 16 }}
        >
          <Stamp label={t("onboarding.readyStamp")} sub={t("onboarding.allSetStamp")} color={theme.teal} rot={-6} size={130} />
        </Animated.View>

        <View style={{ alignSelf: "stretch", alignItems: "flex-start" }}>
          <Eyebrow color={theme.teal}>{t("onboarding.setupComplete")}</Eyebrow>
          <HugeHeadline color={theme.inkDeep}>
            {t("onboarding.readyHeadlinePrefix")}{" "}
            <HeadlineItalic>{t("onboarding.readyHeadlineAccent")}</HeadlineItalic>.
          </HugeHeadline>
        </View>

        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          {t("onboarding.readyLede", { protectedBy: biometric.protectedBy })}
        </Text>
      </View>

      {/* Summary recap */}
      <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
        <View
          style={[
            styles.recap,
            {
              backgroundColor: theme.paperSoft,
              borderColor: theme.hairline,
            },
          ]}
        >
          <Text style={[styles.recapEyebrow, { color: theme.inkMuted }]}>
            {t("onboarding.yourSetup")}
          </Text>
          {rows.map((r, i) => (
            <View
              key={i}
              style={[
                styles.recapRow,
                {
                  borderBottomColor: theme.hairline,
                  borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                  borderStyle: "dashed" as const,
                },
              ]}
            >
              <View
                style={[styles.recapIcon, { backgroundColor: r.c + "22" }]}
              >
                <Icon name={r.i} size={15} color={r.c} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.recapTitle, { color: theme.inkDeep }]}>{r.l}</Text>
                <Text style={[styles.recapSub, { color: theme.inkSoft }]}>{r.v}</Text>
              </View>
              <Icon name="check" size={16} color={theme.teal} strokeWidth={2.5} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
    alignSelf: "stretch",
    textAlign: "left",
  },
  recap: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
  },
  recapEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 12,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  recapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  recapIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  recapTitle: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  recapSub: {
    fontSize: 11.5,
    fontFamily: NOMAD_FONTS.ui,
  },
});
