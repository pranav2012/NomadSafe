import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraButton } from "@/components/aura/AuraButton";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { LiveDot } from "@/components/motion/LiveDot";
import { PressableScale } from "@/components/motion/PressableScale";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { useSettingsStore } from "@/features/settings";
import { AiChat } from "../components/AiChat";
import { AiModelsSheet } from "../components/AiModelsSheet";
import { useAiProvisioning } from "../hooks/useAiProvisioning";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { remoteLabel } from "../utils/remoteLabel";
import { findModel } from "../services/aiModelService";
import { provisionPercent } from "../utils/provisionCopy";

const READY = "#3DDC97";

/** AI tab: chat with the on-device model or online AI, with which one answers in the header. */
export default function AiScreen() {
  const { c, f, isDark, accent } = useAura();
  const { t } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const provisioning = useAiProvisioning();
  const [modelsOpen, setModelsOpen] = useState(false);
  const ai = useAiAvailability();
  const onlineName = ai.remote ? remoteLabel(ai.remote, ai.byok, t("aiTab.cloudName")) : null;
  const chatEnabled = localAiEnabled || ai.configured !== null;

  const activeModel = findModel(provisioning.activeModelId);
  const anyDownloaded = activeModel !== null;
  const downloading = provisioning.phase === "downloading" || provisioning.phase === "verifying";
  const ready = provisioning.phase === "ready" || (anyDownloaded && !downloading);
  const waiting = provisioning.phase === "waitingForWifi";
  const pillText = onlineName
    ? t("aiTab.onlinePill", { provider: onlineName })
    : ready
      ? t("aiTab.offlineReady")
      : downloading
        ? t("aiTab.provision.pillDownloading", { percent: provisionPercent(provisioning) })
        : waiting
          ? t("aiTab.provision.waitingForWifiTitle")
          : t("aiTab.noModel");
  const dotColor = onlineName || ready ? READY : downloading ? accent : waiting ? auraStatusAccent.live : c.textMuted;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("tabs.ai")}</Text>
        {localAiEnabled || onlineName ? (
          <PressableScale
            onPress={() => (localAiEnabled ? setModelsOpen(true) : router.push("/settings"))}
            accessibilityRole="button"
            accessibilityLabel={pillText}
            accessibilityHint={t("aiTab.modelTab")}
            style={[styles.chip, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
          >
            <LiveDot color={dotColor} size={7} active={downloading && !onlineName} />
            <Text numberOfLines={1} style={[styles.chipText, { color: c.text, fontFamily: f.medium }]}>
              {pillText}
            </Text>
            <Icon name="chevronDown" size={13} color={c.textMuted} strokeWidth={2} />
          </PressableScale>
        ) : null}
      </View>

      {chatEnabled ? (
        <>
          <AiChat activeModelName={localAiEnabled ? (activeModel?.name ?? null) : null} />
          <AiModelsSheet visible={modelsOpen} onClose={() => setModelsOpen(false)} />
        </>
      ) : (
        <View style={styles.disabled}>
          <View style={[styles.disabledIcon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="sparkle" size={24} color={c.textSoft} strokeWidth={2} />
          </View>
          <Text style={[styles.disabledTitle, { color: c.text, fontFamily: f.semibold }]}>{t("aiTab.disabledTitle")}</Text>
          <Text style={[styles.disabledBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("aiTab.disabledBody")}</Text>
          <AuraButton label={t("aiTab.disabledAction")} icon="settings" size="md" onPress={() => router.push("/settings")} style={styles.disabledButton} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 34, letterSpacing: -1.2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
  },
  chipText: { fontSize: 13.5, flexShrink: 1, fontVariant: ["tabular-nums"] },
  disabled: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, paddingBottom: 120, gap: 10 },
  disabledIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  disabledTitle: { fontSize: 22, letterSpacing: -0.6, textAlign: "center" },
  disabledBody: { fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  disabledButton: { marginTop: 10 },
});
