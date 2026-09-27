import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useAuthStore, type BiometricPresentation } from "@/features/auth";
import { useAiModels } from "@/features/ai";
import { useLocalization } from "@/localization";
import { Stamp } from "@/components/nomad/Stamp";
import { Icon, type IconName } from "@/components/nomad/Icon";
import {
  Eyebrow,
  HugeHeadline,
  HeadlineItalic,
} from "@/components/nomad/Typography";
import { permissionsService } from "@/features/onboarding/services/permissions";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { isValidPhone } from "@/features/safety/utils/phone";

interface Props {
  theme: NomadTheme;
  biometric: BiometricPresentation;
}

interface RecapRow {
  i: IconName;
  l: string;
  v: string;
  c: string;
  done: boolean;
}

export function ReadyStep({ theme, biometric }: Props) {
  const { t } = useLocalization();
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const { models, capability, isChecking } = useAiModels();
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const [notificationsGranted, setNotificationsGranted] = useState<boolean | null>(null);
  const [contacts] = useState(() => emergencyContactsStorage.get());

  useEffect(() => {
    let mounted = true;
    permissionsService.checkAll().then((status) => {
      if (!mounted) return;
      setLocationGranted(status.location.granted);
      setNotificationsGranted(status.notifications.granted);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const notSet = t("onboarding.notSetYet");
  const contactsWithPhone = contacts.filter((c) => isValidPhone(c.phone)).length;
  const downloadedModel = models.find((m) => m.isDownloaded);
  const downloadingModel = models.find((m) => m.isDownloading || m.isPaused);

  const aiValue = isChecking
    ? t("onboarding.checkingDevice")
    : downloadedModel
      ? t("onboarding.aiReadyValue", { model: downloadedModel.model.name })
      : downloadingModel
        ? t("onboarding.modelDownloading", { progress: downloadingModel.progress })
        : capability?.supported
          ? t("onboarding.aiSkippedValue")
          : t("onboarding.aiUnavailableValue");

  const rows: RecapRow[] = [
    {
      i: "mapPin",
      l: t("onboarding.location"),
      v: locationGranted ? t("onboarding.locationValue") : notSet,
      c: theme.teal,
      done: !!locationGranted,
    },
    {
      i: "users",
      l: t("onboarding.trustedThreeLabel"),
      v:
        contacts.length === 0
          ? notSet
          : contactsWithPhone === 0
            ? t("onboarding.contactsNoPhoneValue", { count: contacts.length })
            : t("onboarding.people", { count: contacts.length }),
      c: theme.mustard,
      done: contactsWithPhone > 0,
    },
    {
      i: "bell",
      l: t("onboarding.checkInReminders"),
      v: notificationsGranted ? t("onboarding.notificationsValue") : notSet,
      c: theme.stamp,
      done: !!notificationsGranted,
    },
    {
      i: "lock",
      l: t("onboarding.vault"),
      v: isPinSet
        ? biometricEnabled
          ? `${t("onboarding.pinSetValue")} · ${biometric.vaultSummary}`
          : t("onboarding.pinSetValue")
        : notSet,
      c: theme.sky,
      done: isPinSet,
    },
    {
      i: "sparkle",
      l: t("onboarding.steps.onDeviceAi"),
      v: aiValue,
      c: theme.teal,
      done: !!downloadedModel,
    },
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
          {t("onboarding.readyLede", {
            protectedBy: biometricEnabled ? biometric.protectedBy : t("onboarding.yourPin"),
          })}
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
              key={r.i}
              accessible
              accessibilityLabel={`${r.l}: ${r.v}`}
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
              {r.done ? (
                <Icon name="check" size={16} color={theme.teal} strokeWidth={2.5} />
              ) : (
                <Icon name="minus" size={16} color={theme.inkMuted} strokeWidth={2.5} />
              )}
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
