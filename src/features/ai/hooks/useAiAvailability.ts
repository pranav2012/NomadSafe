import { useNetworkState } from "expo-network";
import { useAuthStore } from "@/features/auth/store/authStore";
import { usePlanStore } from "@/features/billing/store/planStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useByokStore } from "../services/remote/byok";
import { useAiReadyModelId } from "./useAiProvisioning";

export type RemoteAiRoute = "byok" | "cloud";

/** Which AI the next request would use, for UI that enables or labels AI features. */
export function useAiAvailability() {
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const onlineAiEnabled = useSettingsStore((s) => s.onlineAiEnabled);
  const modelId = useAiReadyModelId();
  const byok = useByokStore((s) => s.summary);
  const cloudAi = usePlanStore((s) => s.cloudAi);
  const signedIn = useAuthStore((s) => s.isSignedIn);
  const network = useNetworkState();

  const online = network.isConnected === true && network.isInternetReachable !== false;
  const configured: RemoteAiRoute | null = !onlineAiEnabled ? null : byok ? "byok" : cloudAi && signedIn ? "cloud" : null;
  const remote = online ? configured : null;
  const local = localAiEnabled && modelId !== null;

  return { remote, configured, local, available: remote !== null || local, online, byok };
}
