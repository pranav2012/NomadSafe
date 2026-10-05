import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  AuraCard,
  AuraListGroup,
  AuraListRow,
  AuraSection,
  AuraSwitch,
  showAlert,
  useAura,
} from "@/atoms";
import { auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { AiPlasmaOrb, AiProvisionCard } from "@/features/ai";
import { modelNotifications, useAiProvisioning, type ProvisionPhase } from "@/modules/ai";
import { useLocalization } from "@/localization";
import { logger } from "@/modules/logger";
import { StepHeader } from "./StepHeader";

const ORB_SIZE = 168;

const READY_BURST_MS = 1800;
const EMPTY_FILL = 0.04;

/** Liquid level for the onboarding orb: the download progress, full once verifying or ready. */
function orbFillFor(phase: ProvisionPhase, progress: number): number {
  switch (phase) {
    case "verifying":
    case "ready":
      return 1;
    case "checking":
    case "queued":
      return EMPTY_FILL;
    default:
      return Math.max(EMPTY_FILL, progress);
  }
}

/** Step 2: expenses and the assistant both run on this phone; the orb mirrors the model download. */
export function OnDeviceStep() {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const { deviceSupported, phase, progress } = useAiProvisioning();
  const [bursting, setBursting] = useState(false);
  const previousPhase = useRef(phase);

  // The corona flares briefly when the model finishes, not when the step opens already ready.
  useEffect(() => {
    const wasReady = previousPhase.current === "ready";
    previousPhase.current = phase;
    if (phase !== "ready" || wasReady) return;
    setBursting(true);
    const timer = setTimeout(() => setBursting(false), READY_BURST_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  const [notifyEnabled, setNotifyEnabled] = useState(() => modelNotifications.isEnabled());
  const supported = deviceSupported !== false && phase !== "unsupportedDevice";

  const toggleNotify = async (wanted: boolean) => {
    try {
      const next = await modelNotifications.setEnabled(wanted);
      setNotifyEnabled(next);
      if (wanted && !next) showAlert(t("onboarding.notificationsOffTitle"), t("onboarding.notificationsOffBody"));
    } catch (err) {
      logger.warn("onboarding", "notification opt-in failed", err);
    }
  };

  return (
    <View style={styles.root}>
      {supported ? (
        <View style={styles.orb} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <AiPlasmaOrb size={ORB_SIZE} mode={bursting ? "thinking" : "idle"} isDark={isDark} fill={orbFillFor(phase, progress)} />
        </View>
      ) : null}

      <StepHeader title={t("onboarding.onDeviceTitle")} lede={t("onboarding.onDeviceLede")} />

      <AuraListGroup title={t("onboarding.importMethodsLabel")}>
        <AuraListRow icon="edit" tone={auraStatusAccent.live} label={t("onboarding.pasteAlertTitle")} detail={t("onboarding.pasteAlertSub")} />
        <AuraListRow icon="mail" tone={auraStatusColors.calm[0]} label={t("onboarding.gmailLaterTitle")} detail={t("onboarding.gmailLaterSub")} />
        <AuraListRow icon="plus" tone={auraStatusColors.calm[1]} label={t("onboarding.manualEntryTitle")} detail={t("onboarding.manualEntrySub")} />
      </AuraListGroup>

      <AuraSection title={t("onboarding.steps.onDeviceAi")} />
      <Text style={[styles.aiLede, { color: c.textSoft, fontFamily: f.regular }]}>{t("onboarding.aiLedeAuto")}</Text>
      <AuraCard>
        <AiProvisionCard mode="onboarding" />
      </AuraCard>

      {supported && phase !== "ready" ? (
        <AuraListGroup style={styles.notify}>
          <AuraListRow
            icon="bell"
            label={t("onboarding.notifyWhenReady")}
            detail={t("onboarding.notifyWhenReadySub")}
            trailing={<AuraSwitch value={notifyEnabled} accessibilityLabel={t("onboarding.notifyWhenReady")} onValueChange={(next) => void toggleNotify(next)} />}
          />
        </AuraListGroup>
      ) : null}

      <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("onboarding.aiContinueHint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingTop: 8 },
  orb: { alignItems: "center", marginBottom: 8 },
  aiLede: { fontSize: 14, lineHeight: 20, marginTop: -6, marginBottom: 14 },
  notify: { marginTop: 12 },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 14, marginHorizontal: 4 },
});
