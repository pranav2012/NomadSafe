import { useEffect } from "react";
import { useAuthStore } from "@/features/auth/store/authStore";
import { configurePurchases, identifyPurchaser } from "../services/purchases";

/** Configures RevenueCat and keeps its customer in step with the signed-in account. */
export function BillingEffects() {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    configurePurchases();
  }, []);

  useEffect(() => {
    void identifyPurchaser(userId);
  }, [userId]);

  return null;
}
