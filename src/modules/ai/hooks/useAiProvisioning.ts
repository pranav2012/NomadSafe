import { useEffect } from "react";
import { useIsFocused } from "expo-router";
import { useShallow } from "zustand/react/shallow";
import {
  downloadAgain,
  enableMobileData,
  ensureProvisioned,
  removeModel,
  retry,
  subscribeProvisioning,
  useProvisioningStore,
  type ProvisioningState,
} from "../local/modelProvisioner";

type ProvisioningActions = {
  isReady: boolean;
  enableMobileData: () => Promise<void>;
  retry: () => Promise<void>;
  removeModel: () => Promise<void>;
  downloadAgain: () => Promise<void>;
};

export type AiProvisioning = ProvisioningState & ProvisioningActions;

/**
 * Live provisioning state for screens that show it; keeps download status polled while focused.
 * Pass `fields` to re-render only when those change (e.g. leave out `progress` when no percent shows).
 */
export function useAiProvisioning(): AiProvisioning;
export function useAiProvisioning<K extends keyof ProvisioningState>(fields: readonly K[]): Pick<ProvisioningState, K> & ProvisioningActions;
export function useAiProvisioning(fields?: readonly (keyof ProvisioningState)[]) {
  const state = useProvisioningStore(
    useShallow((s): Partial<ProvisioningState> => {
      if (!fields) return s;
      const picked: Partial<Record<keyof ProvisioningState, unknown>> = { activeModelId: s.activeModelId };
      for (const field of fields) picked[field] = s[field];
      return picked as Partial<ProvisioningState>;
    }),
  );
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const unsubscribe = subscribeProvisioning();
    void ensureProvisioned();
    return unsubscribe;
  }, [focused]);
  return {
    ...state,
    isReady: state.activeModelId != null,
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
