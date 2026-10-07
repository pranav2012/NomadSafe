export { authClient } from "@/modules/backend";
export { localAuth, type DeviceAuthResult } from "./services/localAuth";
export { useAuth } from "./hooks/useAuth";
export {
  useBiometricPresentation,
  type BiometricPresentation,
} from "./hooks/useBiometricPresentation";
export { useSyncAuthSession } from "./hooks/useSyncAuthSession";
export { removeLegacyPin, useAuthStore } from "./store/authStore";
export { useAppLocked } from "./hooks/useAppLocked";
export { usePrivacyShield } from "./hooks/usePrivacyShield";
export { PrivacyCover } from "./components/PrivacyCover";
