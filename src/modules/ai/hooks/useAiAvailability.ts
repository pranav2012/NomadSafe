import { useNetworkState } from "expo-network";
import { useAuthStore } from "@/features/auth/store/authStore";
import { usePlanStore } from "@/modules/billing";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { allowsLocal, onlineProvidersFor, type AiTask, type OnlineAiState, type RemoteProvider } from "../policy";
import { useAiPreferenceStore } from "../preference";
import { useByokStore } from "../remote/byok";
import { useAiReadyModelId } from "./useAiProvisioning";

/** Policy inputs from the live stores (quota aside), shared by the availability and source hooks. */
export function useAiRouteState(): OnlineAiState {
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const onlineAiEnabled = useSettingsStore((s) => s.onlineAiEnabled);
  const modelId = useAiReadyModelId();
  const hasByokKey = useByokStore((s) => s.summary !== null);
  const cloudAi = usePlanStore((s) => s.cloudAi);
  const signedIn = useAuthStore((s) => s.isSignedIn);
  const preferred = useAiPreferenceStore((s) => s.preferred);
  return { onlineAiEnabled, hasByokKey, cloudAi, signedIn, cloudExhausted: false, preferred, localReady: localAiEnabled && modelId !== null };
}

/** Which AI the next request for `task` would use, per the policy, for UI that enables or labels AI features. */
export function useAiAvailability(task: AiTask = "chat") {
  const state = useAiRouteState();
  const byok = useByokStore((s) => s.summary);
  const network = useNetworkState();

  const online = network.isConnected === true && network.isInternetReachable !== false;
  const configured: RemoteProvider | null = onlineProvidersFor(task, state)[0] ?? null;
  const remote = online ? configured : null;
  const local = allowsLocal(task) && state.localReady === true;

  return { remote, configured, local, available: remote !== null || local, online, byok };
}
