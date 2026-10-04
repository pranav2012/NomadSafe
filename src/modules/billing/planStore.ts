import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { FREE_PLAN, type PlanState } from "./plan";

interface PlanStoreState extends PlanState {
  /** Whether RevenueCat is configured in this build; the paywall can't sell anything without it. */
  billingAvailable: boolean;
  /** The plan is a one-time lifetime purchase, so there's no subscription to manage. */
  lifetime: boolean;
  setPlan: (plan: PlanState) => void;
  setBillingAvailable: (value: boolean) => void;
  setLifetime: (value: boolean) => void;
  reset: () => void;
}

/** Last known plan, kept on the phone so trip limits and cloud AI work offline. */
export const usePlanStore = create<PlanStoreState>()(
  persist(
    (set) => ({
      ...FREE_PLAN,
      billingAvailable: false,
      lifetime: false,
      setPlan: (plan) => set(plan),
      setBillingAvailable: (value) => set({ billingAvailable: value }),
      setLifetime: (value) => set({ lifetime: value }),
      reset: () => set({ ...FREE_PLAN, lifetime: false }),
    }),
    {
      name: "plan-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
      partialize: (state) => ({ unlimitedTrips: state.unlimitedTrips, cloudAi: state.cloudAi, lifetime: state.lifetime }),
    },
  ),
);
