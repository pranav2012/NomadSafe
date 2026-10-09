import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { FREE_PLAN, type PlanState } from "./plan";

interface PlanStoreState extends PlanState {
  storePlan: PlanState;
  /** From the server: store purchases it has seen plus plans granted without one (e.g. the review account). */
  serverPlan: PlanState;
  /** Whether RevenueCat is configured in this build; the paywall can't sell anything without it. */
  billingAvailable: boolean;
  /** The plan is a one-time lifetime purchase, so there's no subscription to manage. */
  lifetime: boolean;
  setPlan: (plan: PlanState) => void;
  setServerPlan: (plan: PlanState) => void;
  setBillingAvailable: (value: boolean) => void;
  setLifetime: (value: boolean) => void;
  reset: () => void;
}

function merge(a: PlanState, b: PlanState): PlanState {
  return { unlimitedTrips: a.unlimitedTrips || b.unlimitedTrips, cloudAi: a.cloudAi || b.cloudAi };
}

/** Last known plan, kept on the phone so trip limits and cloud AI work offline. `unlimitedTrips`/`cloudAi` are the better of both sources. */
export const usePlanStore = create<PlanStoreState>()(
  persist(
    (set) => ({
      ...FREE_PLAN,
      storePlan: FREE_PLAN,
      serverPlan: FREE_PLAN,
      billingAvailable: false,
      lifetime: false,
      setPlan: (plan) => set((state) => ({ storePlan: plan, ...merge(plan, state.serverPlan) })),
      setServerPlan: (plan) => set((state) => ({ serverPlan: plan, ...merge(state.storePlan, plan) })),
      setBillingAvailable: (value) => set({ billingAvailable: value }),
      setLifetime: (value) => set({ lifetime: value }),
      reset: () => set({ ...FREE_PLAN, storePlan: FREE_PLAN, serverPlan: FREE_PLAN, lifetime: false }),
    }),
    {
      name: "plan-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 2,
      partialize: (state) => ({
        unlimitedTrips: state.unlimitedTrips,
        cloudAi: state.cloudAi,
        storePlan: state.storePlan,
        serverPlan: state.serverPlan,
        lifetime: state.lifetime,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<PlanStoreState>;
        if (version < 2) {
          const plan = { unlimitedTrips: state.unlimitedTrips ?? false, cloudAi: state.cloudAi ?? false };
          return { ...state, storePlan: plan, serverPlan: FREE_PLAN };
        }
        return state;
      },
    },
  ),
);
