import { useEffect } from "react";
import { usePlanStore } from "@/modules/billing";
import { setAdsSuspended, startAds, stopAds } from "./ads";

/** Starts consent and ads for free users once `ready`, holds them back while not ready, and stops them once the plan is paid. */
export function AdsEffects({ ready }: { ready: boolean }) {
  const paid = usePlanStore((s) => s.unlimitedTrips);

  useEffect(() => {
    setAdsSuspended(!ready);
    if (paid) stopAds();
    else if (ready) startAds();
  }, [paid, ready]);

  return null;
}
