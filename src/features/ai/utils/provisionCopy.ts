import { AI_MODELS, formatBytes } from "../services/aiModelService";
import type { ProvisioningState } from "../services/modelProvisioner";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface ProvisionCopy {
  title: string;
  body: string | null;
}

export function provisionPercent(state: Pick<ProvisioningState, "progress">): number {
  return Math.min(100, Math.max(0, Math.round(state.progress * 100)));
}

/** Title + body describing the current provisioning phase, shared by onboarding and the AI tab. */
export function provisionCopy(state: ProvisioningState, t: Translate, locale: string, usesSystemDownloader: boolean): ProvisionCopy {
  const name = state.model?.name ?? "";
  const size = state.model ? formatBytes(state.model.sizeBytes, locale) : "";
  switch (state.phase) {
    case "checking":
      return { title: t("aiTab.provision.checking"), body: null };
    case "unsupportedDevice":
      return {
        title: t("aiTab.provision.unsupportedTitle"),
        body: t("aiTab.provision.unsupportedBody", { ram: AI_MODELS[0].minRamGb }),
      };
    case "disabled":
      return { title: t("aiTab.provision.disabledTitle"), body: t("aiTab.provision.disabledBody") };
    case "insufficientStorage":
      return {
        title: t("aiTab.provision.insufficientStorageTitle"),
        body: t("aiTab.provision.insufficientStorageBody", {
          model: name,
          size: formatBytes(state.requiredFreeBytes, locale),
        }),
      };
    case "waitingForWifi":
      return { title: t("aiTab.provision.waitingForWifiTitle"), body: t("aiTab.provision.waitingForWifiBody", { size }) };
    case "queued":
      return { title: t("aiTab.provision.queuedTitle"), body: t("aiTab.provision.queuedBody") };
    case "downloading":
      return {
        title: t("aiTab.provision.downloadingTitle", { model: name }),
        body: usesSystemDownloader ? t("aiTab.provision.backgroundHintSystem") : t("aiTab.provision.backgroundHint"),
      };
    case "verifying":
      return { title: t("aiTab.provision.verifyingTitle"), body: t("aiTab.provision.verifyingBody") };
    case "ready":
      return { title: t("aiTab.provision.readyTitle", { model: name }), body: t("aiTab.provision.readyBody") };
    case "removed":
      return { title: t("aiTab.provision.removedTitle"), body: t("aiTab.provision.removedBody") };
    case "error":
      return {
        title: t("aiTab.provision.errorTitle"),
        body: t(`aiTab.provision.error.${state.errorCode ?? "unknown"}`),
      };
  }
}

/** Progress line, e.g. "42% · 580 MB of 1.3 GB". */
export function provisionProgressText(state: ProvisioningState, t: Translate, locale: string): string {
  const total = state.model?.sizeBytes ?? 0;
  return t("aiTab.provision.progress", {
    percent: provisionPercent(state),
    done: formatBytes(state.bytesDownloaded, locale),
    total: formatBytes(total, locale),
  });
}

/** One-line status for chat / other AI features when no model is usable yet. */
export function provisionUnavailableText(state: ProvisioningState, t: Translate): string {
  switch (state.phase) {
    case "downloading":
    case "verifying":
      return t("aiTab.provision.chatDownloading", { percent: provisionPercent(state) });
    case "queued":
      return t("aiTab.provision.chatQueued");
    case "waitingForWifi":
      return t("aiTab.provision.chatWaitingForWifi");
    case "insufficientStorage":
      return t("aiTab.provision.chatInsufficientStorage");
    case "unsupportedDevice":
      return t("aiTab.provision.chatUnsupported");
    case "removed":
      return t("aiTab.provision.chatRemoved");
    case "error":
      return t("aiTab.provision.chatError");
    default:
      return t("aiTab.provision.chatPreparing");
  }
}
