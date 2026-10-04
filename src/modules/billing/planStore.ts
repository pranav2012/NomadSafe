import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { FREE_PLAN, type PlanState } from "./plan";

interface PlanStoreState extends PlanState {
  /** Whether RevenueCat is configured in this build; the paywall can't sell anything without it. */
  billingAvailable: boolean;
  setPlan: (plan: PlanState) => void;
  setBillingAvailable: (value: boolean) => void;
  reset: () => void;
}

/** Last known plan, kept on the phone so trip limits and cloud AI work offline. */
export const usePlanStore = create<PlanStoreState>()(
  persist(
    (set) => ({
      ...FREE_PLAN,
      billingAvailable: false,
      setPlan: (plan) => set(plan),
      setBillingAvailable: (value) => set({ billingAvailable: value }),
      reset: () => set(FREE_PLAN),
    }),
    {
      name: "plan-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
      partialize: (state) => ({ unlimitedTrips: state.unlimitedTrips, cloudAi: state.cloudAi }),
    },
  ),
);
