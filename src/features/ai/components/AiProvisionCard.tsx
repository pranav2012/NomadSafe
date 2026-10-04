import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { AuraButton, Icon, type IconName, showAlert, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { aiRuntime, findModel, formatBytes, useAiProvisioning, type ProvisionPhase } from "@/modules/ai";
import { provisionCopy, provisionPercent, provisionProgressText } from "../utils/provisionCopy";

interface Props {
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

const READY = "#3DDC97";

export function AiProvisionCard({ mode, busy = false }: Props) {
  const { c, f, accent: calm } = useAura();
  const { t, locale } = useLocalization();
  const provisioning = useAiProvisioning();
  const { phase, model } = provisioning;
  const copy = provisionCopy(provisioning, t, locale, aiRuntime.usesSystemDownloader());
  const percent = provisionPercent(provisioning);
  const showProgress = PROGRESS_PHASES.has(phase) && model !== null;
  const activeModel = findModel(provisioning.activeModelId);
  const usingInterim = activeModel !== null && phase !== "ready";
  const alert = phase === "error" || phase === "insufficientStorage" || phase === "unsupportedDevice";
  const accent = phase === "ready" ? READY : alert ? auraStatusAccent.alert : phase === "waitingForWifi" ? auraStatusAccent.live : calm;

  const confirmRemove = () => {
    if (!activeModel) return;
    showAlert(
      t("aiTab.provision.removeConfirmTitle"),
      t("aiTab.provision.removeConfirmBody", { model: activeModel.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: () => void provisioning.removeModel() },
      ],
    );
  };

  return (
    <View style={styles.root}>
      {model && phase !== "unsupportedDevice" ? (
        <View style={styles.modelRow}>
          <View style={[styles.modelIcon, { backgroundColor: `${calm}24` }]}>
            <Icon name="sparkle" size={17} color={calm} strokeWidth={2} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.modelName, { color: c.text, fontFamily: f.semibold }]}>{model.name}</Text>
            <Text style={[styles.modelMeta, { color: c.textMuted, fontFamily: f.regular }]}>
              {t("aiTab.provision.pickedForPhone")} · {t("aiTab.provision.modelMeta", { size: formatBytes(model.sizeBytes, locale) })}
            </Text>
          </View>
        </View>
      ) : null}

      <View
        accessibilityRole={alert ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={[styles.status, { backgroundColor: `${accent}14`, borderColor: `${accent}55` }]}
      >
        {phase === "checking" || phase === "verifying" ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <Icon name={phaseIcon(phase)} size={18} color={accent} strokeWidth={2} />
        )}
        <View style={styles.flex}>
          <Text style={[styles.statusTitle, { color: c.text, fontFamily: f.semibold }]}>{copy.title}</Text>
          {copy.body ? <Text style={[styles.statusBody, { color: c.textSoft, fontFamily: f.regular }]}>{copy.body}</Text> : null}
        </View>
      </View>

      {showProgress ? (
        <View style={styles.progressWrap}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={[styles.track, { backgroundColor: c.surfaceStrong }]}
          >
            <View style={[styles.fill, { width: `${percent}%`, backgroundColor: accent }]} />
          </View>
          <Text style={[styles.progressText, { color: c.textMuted, fontFamily: f.regular }]}>{provisionProgressText(provisioning, t, locale)}</Text>
        </View>
      ) : null}

      {usingInterim ? <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiTab.provision.usingPrevious")}</Text> : null}

      <View style={styles.actions}>
        {phase === "waitingForWifi" ? (
          <AuraButton label={t("aiTab.provision.useMobileData")} icon="download" size="md" onPress={() => void provisioning.enableMobileData()} />
        ) : null}
        {phase === "error" || phase === "insufficientStorage" ? (
          <AuraButton label={t("aiTab.provision.retry")} size="md" onPress={() => void provisioning.retry()} />
        ) : null}
        {mode === "manage" && phase === "removed" && model ? (
          <AuraButton
            label={t("aiTab.provision.downloadAgain", { size: formatBytes(model.sizeBytes, locale) })}
            icon="download"
            size="md"
            onPress={() => void provisioning.downloadAgain()}
          />
        ) : null}
        {mode === "manage" && activeModel && phase !== "verifying" ? (
          <AuraButton
            label={t("aiTab.provision.remove", { size: formatBytes(activeModel.sizeBytes, locale) })}
            icon="trash"
            variant="secondary"
            size="md"
            disabled={busy}
            onPress={confirmRemove}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  flex: { flex: 1 },
  modelRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  modelIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  modelName: { fontSize: 16 },
  modelMeta: { fontSize: 12.5, marginTop: 2 },
  status: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  statusTitle: { fontSize: 14.5 },
  statusBody: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  progressWrap: { gap: 6 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  progressText: { fontSize: 12.5, fontVariant: ["tabular-nums"] },
  note: { fontSize: 12.5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
