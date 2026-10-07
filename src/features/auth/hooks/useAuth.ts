import { authClient, useAuthStore } from "@/features/auth";

/**
 * Combined hook for account auth (Better Auth session) and local lock state.
 * Reads from Zustand for fast, offline-available access.
 */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const lockEnabled = useAuthStore((s) => s.lockEnabled);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const autoLockTimeout = useAuthStore((s) => s.autoLockTimeout);

  const session = authClient.useSession();

  return {
    user,
    isSignedIn,
    lockEnabled,
    isUnlocked,
    autoLockTimeout,
    session,
    isLoading: session.isPending,
  };
}
