import { useEffect } from "react";
import { useIsFocused } from "expo-router";
import {
  downloadAgain,
  enableMobileData,
  ensureProvisioned,
  removeModel,
  retry,
  subscribeProvisioning,
  useProvisioningStore,
  type ProvisioningState,
} from "../services/modelProvisioner";

export interface AiProvisioning extends ProvisioningState {
  isReady: boolean;
  enableMobileData: () => Promise<void>;
  retry: () => Promise<void>;
  removeModel: () => Promise<void>;
  downloadAgain: () => Promise<void>;
}

/** Live provisioning state for screens that show it; keeps download status polled while focused. */
export function useAiProvisioning(): AiProvisioning {
  const state = useProvisioningStore();
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const unsubscribe = subscribeProvisioning();
    void ensureProvisioned();
    return unsubscribe;
  }, [focused]);
  return {
    ...state,
    isReady: state.activeModelId !== null,
    enableMobileData,
    retry,
    removeModel,
    downloadAgain,
  };
}

/** Id of the usable model, without polling; for features that only need readiness. */
export function useAiReadyModelId() {
  return useProvisioningStore((s) => s.activeModelId);
}
