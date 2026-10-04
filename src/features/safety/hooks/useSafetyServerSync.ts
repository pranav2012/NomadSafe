import { useEffect } from "react";
import { useConvexAuth } from "@/modules/backend";
import { syncCheckInDeadline } from "../services/safetyServerAlerts";
import { useSafetyStore } from "../store/safetyStore";

/** Keeps the server's copy of the check-in deadline in step with the store while signed in. */
export function useSafetyServerSync() {
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    void syncCheckInDeadline();
    return useSafetyStore.subscribe((state, prev) => {
      if (state.status !== prev.status || state.checkInEndsAt !== prev.checkInEndsAt) void syncCheckInDeadline();
    });
  }, [isAuthenticated]);
}
