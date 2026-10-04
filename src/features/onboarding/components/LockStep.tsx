import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { AuraListGroup, AuraListRow, Icon, type IconName, PressableScale, useAura } from "@/atoms";
import { auraStatusColors } from "@/constants/aura";
import { localAuth, useAuthStore, type BiometricPresentation } from "@/features/auth";
import { BiometricGlyph } from "@/features/auth/components/BiometricGlyph";
import { provisionPercent } from "@/features/ai";
import { findModel, useAiProvisioning } from "@/modules/ai";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { permissionsService } from "@/features/onboarding/services/permissions";
import { isValidPhone } from "@/features/safety/utils/phone";
import { useLocalization } from "@/localization";
import { successNotification } from "@/utils/haptics";
import { logger } from "@/modules/logger";
import { StepHeader } from "./StepHeader";

const MATCHED = "#3DDC97";
const TILE = 116;

/** Step 3: biometrics and the backup PIN; once a PIN exists, a recap of everything set up. */
export function LockStep({ biometric }: { biometric: BiometricPresentation }) {
  const isPinSet = useAuthStore((s) => s.isPinSet);
  return isPinSet ? <SetupRecap biometric={biometric} /> : <LockIntro biometric={biometric} />;
}

function LockIntro({ biometric }: { biometric: BiometricPresentation }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [matched, setMatched] = useState(false);

  useEffect(() => {
    let mounted = true;
    localAuth
      .checkBiometricAvailability()
      .then(({ available }) => mounted && setEnrolled(available))
      .catch(() => mounted && setEnrolled(false));
    return () => {
      mounted = false;
    };
  }, []);

  // A test only: shows the matched pill, writes no setting (SetupPin enables biometrics).
  const tryBiometric = async () => {
    try {
      const { available } = await localAuth.checkBiometricAvailability();
      if (!available) return;
      const success = await localAuth.authenticateWithBiometric({
        promptMessage: t("onboarding.biometricPrompt"),
        cancelLabel: t("common.cancel"),
      });
      setMatched(success);
      if (success) successNotification();
    } catch (err) {
      logger.warn("onboarding", "biometric check failed", err);
    }
  };

  const glyphColor = matched ? MATCHED : enrolled ? c.text : c.textMuted;

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <PressableScale
          onPress={() => void tryBiometric()}
          disabled={!enrolled}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.tryBiometric", { biometricName: biometric.name })}
          accessibilityState={{ disabled: !enrolled }}
          style={[
            styles.tile,
            { backgroundColor: matched ? `${MATCHED}1F` : c.surfaceStrong, borderColor: matched ? `${MATCHED}66` : c.hairline },
          ]}
        >
          <BiometricGlyph kind={biometric.kind} size={58} color={glyphColor} />
        </PressableScale>
        {matched ? (
          <Animated.View entering={ZoomIn.springify().damping(14)} style={[styles.pill, { backgroundColor: `${MATCHED}1F` }]} accessibilityLiveRegion="polite">
            <Icon name="check" size={14} color={MATCHED} strokeWidth={2.6} />
            <Text style={[styles.pillText, { color: MATCHED, fontFamily: f.semibold }]}>{biometric.matchedLabel}</Text>
          </Animated.View>
        ) : enrolled ? (
          <Text style={[styles.tryHint, { color: c.textMuted, fontFamily: f.medium }]}>{t("onboarding.tapToTry", { biometricName: biometric.name })}</Text>
        ) : null}
      </View>

      <StepHeader title={t("onboarding.lockTitle")} lede={t("onboarding.lockLede", { biometricName: biometric.name })} />

      <AuraListGroup>
        {enrolled === null ? (
          <AuraListRow icon="faceId" label={t("onboarding.checkingBiometric")} trailing={<ActivityIndicator color={c.textMuted} />} />
        ) : (
          <AuraListRow
            icon="faceId"
            tone={enrolled ? auraStatusColors.calm[0] : undefined}
            label={enrolled ? biometric.name : t("onboarding.biometricNotSetUp")}
            detail={enrolled ? t("onboarding.unlockVault") : t("onboarding.biometricSetUpSub")}
          />
        )}
        <AuraListRow icon="lock" tone={auraStatusColors.calm[2]} label={t("onboarding.pinRowTitle")} detail={t("onboarding.pinRowBody", { biometricName: biometric.name })} />
        <AuraListRow icon="clock" label={t("onboarding.autoLock")} detail={t("onboarding.autoLockSub")} />
      </AuraListGroup>
    </View>
  );
}

interface RecapRow {
  icon: IconName;
  label: string;
  value: string;
  done: boolean;
}

function SetupRecap({ biometric }: { biometric: BiometricPresentation }) {
  const { c } = useAura();
  const { t } = useLocalization();
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const provisioning = useAiProvisioning();
  const [locationGranted, setLocationGranted] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [contacts] = useState(() => emergencyContactsStorage.get());

  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      permissionsService.checkAll().then((status) => {
        if (!mounted) return;
        setLocationGranted(status.location.granted);
        setNotificationsGranted(status.notifications.granted);
      });
    void refresh();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const notSet = t("onboarding.notSetYet");
  const withPhone = contacts.filter((contact) => isValidPhone(contact.phone)).length;
  const readyModel = findModel(provisioning.activeModelId);

  const aiValue = (() => {
    switch (provisioning.phase) {
      case "ready":
        return readyModel ? t("onboarding.aiReadyValue", { model: readyModel.name }) : t("aiTab.provision.checking");
      case "queued":
      case "downloading":
      case "verifying":
        return t("onboarding.aiDownloadingValue", { percent: provisionPercent(provisioning) });
      case "waitingForWifi":
        return t("onboarding.aiWaitingValue");
      case "insufficientStorage":
        return t("onboarding.aiStorageValue");
      case "unsupportedDevice":
        return t("onboarding.aiUnavailableValue");
      case "disabled":
        return t("onboarding.aiOffValue");
      case "error":
        return t("onboarding.aiErrorValue");
      default:
        return readyModel ? t("onboarding.aiReadyValue", { model: readyModel.name }) : t("aiTab.provision.checking");
    }
  })();

  const rows: RecapRow[] = [
    { icon: "mapPin", label: t("onboarding.location"), value: locationGranted ? t("onboarding.locationValue") : notSet, done: locationGranted },
    {
      icon: "users",
      label: t("onboarding.trustedThreeLabel"),
      value:
        contacts.length === 0
          ? notSet
          : withPhone === 0
            ? t("onboarding.contactsNoPhoneValue", { count: contacts.length })
            : t("onboarding.people", { count: contacts.length }),
      done: withPhone > 0,
    },
    { icon: "bell", label: t("onboarding.checkInReminders"), value: notificationsGranted ? t("onboarding.notificationsValue") : notSet, done: notificationsGranted },
    {
      icon: "lock",
      label: t("onboarding.vault"),
      value: biometricEnabled ? `${t("onboarding.pinSetValue")} · ${biometric.vaultSummary}` : t("onboarding.pinSetValue"),
      done: true,
    },
    { icon: "sparkle", label: t("onboarding.steps.onDeviceAi"), value: aiValue, done: provisioning.phase === "ready" },
  ];
  const doneCount = rows.filter((row) => row.done).length;

  return (
    <Animated.View entering={FadeIn.duration(360)} style={styles.root}>
      <StepHeader
        title={t("onboarding.readyTitle")}
        lede={t("onboarding.readyLede", { protectedBy: biometricEnabled ? biometric.protectedBy : t("onboarding.yourPin") })}
      />
      <AuraListGroup title={t("onboarding.recapCount", { done: doneCount, total: rows.length })}>
        {rows.map((row, index) => (
          <View key={row.icon} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
            <AuraListRow
              icon={row.icon}
              tone={row.done ? auraStatusColors.calm[index % 3] : undefined}
              label={row.label}
              detail={row.value}
              trailing={
                <View style={[styles.mark, { backgroundColor: row.done ? `${MATCHED}24` : c.surfaceStrong }]}>
                  <Icon name={row.done ? "check" : "minus"} size={14} color={row.done ? MATCHED : c.textMuted} strokeWidth={2.6} />
                </View>
              }
            />
          </View>
        ))}
      </AuraListGroup>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingTop: 8 },
  hero: { alignItems: "center", gap: 14, marginTop: 8, marginBottom: 28 },
  tile: { width: TILE, height: TILE, borderRadius: 36, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 },
  pillText: { fontSize: 13.5 },
  tryHint: { fontSize: 13.5, paddingVertical: 7 },
  mark: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
