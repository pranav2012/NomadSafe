import React from "react";
import { View, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { NomadButton } from "@/components/nomad/Button";
import { useAiProvisioning } from "../hooks/useAiProvisioning";
import { aiModelService, findModel, formatBytes } from "../services/aiModelService";
import type { ProvisionPhase } from "../services/modelProvisioner";
import { provisionCopy, provisionPercent, provisionProgressText } from "../utils/provisionCopy";

interface Props {
  theme: NomadTheme;
  /** "manage" adds Remove / Download again (AI tab); onboarding only shows status. */
  mode: "onboarding" | "manage";
  /** Blocks removing the model while a reply is generating. */
  busy?: boolean;
}

const PROGRESS_PHASES: ReadonlySet<ProvisionPhase> = new Set(["queued", "downloading", "waitingForWifi", "verifying"]);

function phaseIcon(phase: ProvisionPhase): IconName {
  switch (phase) {
    case "ready":
      return "check";
    case "waitingForWifi":
      return "wifi";
    case "downloading":
    case "queued":
      return "download";
    case "unsupportedDevice":
    case "insufficientStorage":
    case "error":
      return "alertTriangle";
    default:
      return "cpu";
  }
}

export function AiProvisionCard({ theme, mode, busy = false }: Props) {
  const { t, locale } = useLocalization();
  const provisioning = useAiProvisioning();
  const { phase, model } = provisioning;
  const copy = provisionCopy(provisioning, t, locale, aiModelService.usesSystemDownloader());
  const percent = provisionPercent(provisioning);
  const showProgress = PROGRESS_PHASES.has(phase) && model !== null;
  const activeModel = findModel(provisioning.activeModelId);
  const usingInterim = activeModel !== null && phase !== "ready";
  const alert = phase === "error" || phase === "insufficientStorage" || phase === "unsupportedDevice";
  const accent = phase === "ready" ? theme.teal : alert ? theme.stamp : phase === "waitingForWifi" ? theme.mustard : theme.sky;
  const accentSoft = phase === "ready" ? theme.tealSoft : alert ? theme.stampSoft : theme.paper;

  const confirmRemove = () => {
    if (!activeModel) return;
    Alert.alert(
      t("aiTab.provision.removeConfirmTitle"),
      t("aiTab.provision.removeConfirmBody", { model: activeModel.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => void provisioning.removeModel(),
        },
      ],
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
      {model && phase !== "unsupportedDevice" ? (
        <View style={styles.modelRow}>
          <View style={[styles.modelIcon, { backgroundColor: theme.teal + "22" }]}>
            <Icon name="sparkle" size={16} color={theme.teal} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.modelName, { color: theme.inkDeep }]}>{model.name}</Text>
              <View style={[styles.badge, { backgroundColor: theme.mustard }]}>
                <Text style={[styles.badgeText, { color: theme.inkDeep }]}>{t("aiTab.provision.pickedForPhone")}</Text>
              </View>
            </View>
            <Text style={[styles.modelMeta, { color: theme.inkMuted }]}>
              {t("aiTab.provision.modelMeta", { size: formatBytes(model.sizeBytes, locale) })}
            </Text>
          </View>
        </View>
      ) : null}

      <View
        accessibilityRole={alert ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={[styles.statusRow, { backgroundColor: accentSoft, borderColor: accent }]}
      >
        {phase === "checking" || phase === "verifying" ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <Icon name={phaseIcon(phase)} size={18} color={accent} strokeWidth={2} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusTitle, { color: theme.inkDeep }]}>{copy.title}</Text>
          {copy.body ? <Text style={[styles.statusBody, { color: theme.inkSoft }]}>{copy.body}</Text> : null}
        </View>
      </View>

      {showProgress ? (
        <View style={styles.progressWrap}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={[styles.track, { backgroundColor: theme.hairline }]}
          >
            <View
              style={[
                styles.fill,
                { width: `${percent}%`, backgroundColor: phase === "downloading" || phase === "verifying" ? theme.teal : theme.mustard },
              ]}
            />
          </View>
          <Text style={[styles.progressText, { color: theme.inkSoft }]}>
            {provisionProgressText(provisioning, t, locale)}
          </Text>
        </View>
      ) : null}

      {usingInterim ? (
        <Text style={[styles.note, { color: theme.inkMuted }]}>{t("aiTab.provision.usingPrevious")}</Text>
      ) : null}

      <View style={styles.actions}>
        {phase === "waitingForWifi" ? (
          <NomadButton
            variant="teal"
            theme={theme}
            onPress={() => void provisioning.enableMobileData()}
            icon={<Icon name="download" size={15} color="#fff" strokeWidth={2} />}
          >
            {t("aiTab.provision.useMobileData")}
          </NomadButton>
        ) : null}
        {phase === "error" || phase === "insufficientStorage" ? (
          <NomadButton variant="primary" theme={theme} onPress={() => void provisioning.retry()}>
            {t("aiTab.provision.retry")}
          </NomadButton>
        ) : null}
        {mode === "manage" && phase === "removed" && model ? (
          <NomadButton
            variant="primary"
            theme={theme}
            onPress={() => void provisioning.downloadAgain()}
            icon={<Icon name="download" size={15} color={theme.paperSoft} strokeWidth={2} />}
          >
            {t("aiTab.provision.downloadAgain", { size: formatBytes(model.sizeBytes, locale) })}
          </NomadButton>
        ) : null}
        {mode === "manage" && activeModel && phase !== "verifying" ? (
          <NomadButton
            variant="ghost"
            theme={theme}
            disabled={busy}
            onPress={confirmRemove}
            icon={<Icon name="trash" size={15} color={theme.inkSoft} strokeWidth={2} />}
          >
            {t("aiTab.provision.remove", { size: formatBytes(activeModel.sizeBytes, locale) })}
          </NomadButton>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  modelRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  modelIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  modelName: { fontSize: 15, fontFamily: NOMAD_FONTS.uiSemi },
  modelMeta: { fontSize: 10.5, marginTop: 2, fontFamily: NOMAD_FONTS.mono, letterSpacing: 0.2 },
  badge: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 999 },
  badgeText: { fontSize: 8.5, letterSpacing: 0.4, fontFamily: NOMAD_FONTS.uiBold },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusTitle: { fontSize: 13, fontFamily: NOMAD_FONTS.uiSemi },
  statusBody: { fontSize: 11.5, marginTop: 2, lineHeight: 16, fontFamily: NOMAD_FONTS.ui },
  progressWrap: { gap: 6 },
  track: { height: 6, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  progressText: { fontSize: 11, fontFamily: NOMAD_FONTS.mono },
  note: { fontSize: 11, fontFamily: NOMAD_FONTS.ui },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
