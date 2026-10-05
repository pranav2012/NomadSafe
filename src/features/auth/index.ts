export { authClient } from "@/modules/backend";
export { localAuth } from "./services/localAuth";
export { secureStorage } from "./services/secureStorage";
export { useAuth } from "./hooks/useAuth";
export {
  useBiometricPresentation,
  type BiometricPresentation,
} from "./hooks/useBiometricPresentation";
export { useSyncAuthSession } from "./hooks/useSyncAuthSession";
export { useAuthStore } from "./store/authStore";
export { useOwnerConfirm } from "./hooks/useOwnerConfirm";
export { useAppLocked } from "./hooks/useAppLocked";
export { usePrivacyShield } from "./hooks/usePrivacyShield";
export { PrivacyCover } from "./components/PrivacyCover";
