import { useEffect } from "react";
import { usePlanStore } from "@/modules/billing";
import { startAds, stopAds } from "./ads";

/** Starts consent and ads for free users once `ready`; stops them as soon as the plan is paid. */
export function AdsEffects({ ready }: { ready: boolean }) {
  const paid = usePlanStore((s) => s.unlimitedTrips);

  useEffect(() => {
    if (paid) stopAds();
    else if (ready) startAds();
  }, [paid, ready]);

  return null;
}
