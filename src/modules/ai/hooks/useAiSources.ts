import { useLocalization } from "@/localization";
import { AI_TASK_ROUTES, effectivePreference, providerOrder, type AiProvider, type AiTask } from "../policy";
import { setPreferredAiSource } from "../preference";
import { useByokStore } from "../remote/byok";
import { byokProviderName } from "../labels";
import { findModel } from "../local/aiModelService";
import { useAiReadyModelId } from "./useAiProvisioning";
import { useAiRouteState } from "./useAiAvailability";

export interface AiSource {
  id: AiProvider;
  label: string;
  detail: string;
  online: boolean;
}

const DISPLAY_ORDER: readonly AiProvider[] = ["cloud", "byok", "local"];

/** Sources the user can pick for `task` (connectivity aside); `current` is the valid pick, else the automatic first. */
export function useAiSources(task: AiTask = "chat") {
  const { t } = useLocalization();
  const state = useAiRouteState();
  const byok = useByokStore((s) => s.summary);
  const modelName = findModel(useAiReadyModelId())?.name ?? null;

  const usable: Record<AiProvider, boolean> = {
    cloud: state.onlineAiEnabled && state.cloudAi && state.signedIn,
    byok: state.onlineAiEnabled && byok !== null,
    local: state.localReady === true,
  };
  const describe = (id: AiProvider): AiSource => {
    if (id === "cloud") return { id, label: t("aiTab.cloudName"), detail: t("aiSource.cloudDetail"), online: true };
    if (id === "byok") {
      const provider = byok ? byokProviderName(byok) : "API";
      return { id, label: t("aiSource.byok", { provider }), detail: t("aiSource.byokDetail", { model: byok?.model ?? "" }), online: true };
    }
    return { id, label: t("aiSource.local", { model: modelName ?? "" }), detail: t("aiSource.localDetail"), online: false };
  };

  const sources = DISPLAY_ORDER.filter((id) => usable[id] && AI_TASK_ROUTES[task].includes(id)).map(describe);
  const selected = effectivePreference(task, state);
  const automatic = providerOrder(task, { ...state, preferred: null }).find((id) => sources.some((s) => s.id === id)) ?? null;
  const current = selected ?? automatic;

  return { sources, selected, current, select: (id: AiProvider) => setPreferredAiSource(id) };
}
