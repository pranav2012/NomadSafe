import { useEffect } from "react";
import { authClient } from "../services/authClient";
import { useAuthStore } from "../store/authStore";

/**
 * Keeps the local Zustand auth state in sync with the real Better Auth session.
 * Call this once high in the tree (e.g. RootLayout) so the app reacts to actual
 * sign-in / sign-out events instead of manual flags.
 */
export function useSyncAuthSession() {
  const session = authClient.useSession();
  const setUser = useAuthStore((s) => s.setUser);
  const setSignedIn = useAuthStore((s) => s.setSignedIn);

  useEffect(() => {
    if (session.isPending) return;

    const user = session.data?.user ?? null;

    setUser(
      user
        ? {
            id: user.id,
            name: user.name ?? "",
            email: user.email ?? undefined,
            phone: undefined,
            avatarUrl: user.image ?? undefined,
          }
        : null,
    );
    setSignedIn(!!user);
  }, [session.isPending, session.data?.user, setUser, setSignedIn]);

  return session;
}
