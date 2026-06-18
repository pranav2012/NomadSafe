import { useAuthStore } from "@/stores/authStore";
import { authClient } from "@/lib/auth-client";

/**
 * Combined hook for account auth (Better Auth session) and local lock state.
 * Reads from Zustand for fast, offline-available access.
 */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const autoLockTimeout = useAuthStore((s) => s.autoLockTimeout);

  const session = authClient.useSession();

  return {
    user,
    isSignedIn,
    isPinSet,
    biometricEnabled,
    isUnlocked,
    autoLockTimeout,
    session,
    isLoading: session.isPending,
  };
}
