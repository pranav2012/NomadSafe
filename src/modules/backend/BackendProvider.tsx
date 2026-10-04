import type { ReactNode } from "react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "./authClient";
import { convex } from "./client";

/** Provides the Convex client to React, authenticated with the Better Auth session. */
export function BackendProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
