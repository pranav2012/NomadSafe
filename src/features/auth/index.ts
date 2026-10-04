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
