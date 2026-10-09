import { useEffect } from "react";
import { useAuthStore } from "@/features/auth/store/authStore";
import { api, useConvexAuth, useQuery } from "@/modules/backend";
import { configurePurchases, identifyPurchaser } from "./purchases";
import { FREE_PLAN } from "./plan";
import { usePlanStore } from "./planStore";

/** Configures RevenueCat, keeps its customer in step with the signed-in account, and mirrors the server's plan (grants included). */
export function BillingEffects() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { isAuthenticated } = useConvexAuth();
  const serverPlan = useQuery(api.billing.myPlan, isAuthenticated && userId ? {} : "skip");

  useEffect(() => {
    configurePurchases();
  }, []);

  useEffect(() => {
    void identifyPurchaser(userId);
  }, [userId]);

  useEffect(() => {
    if (userId) return;
    usePlanStore.getState().setServerPlan(FREE_PLAN);
    usePlanStore.getState().setBeta(false);
  }, [userId]);

  useEffect(() => {
    if (!serverPlan) return;
    usePlanStore.getState().setServerPlan({ unlimitedTrips: serverPlan.unlimitedTrips, cloudAi: serverPlan.cloudAi });
    usePlanStore.getState().setBeta(serverPlan.beta);
  }, [serverPlan]);

  return null;
}
