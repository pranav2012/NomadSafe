import { useEffect } from "react";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Device from "expo-device";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { create } from "zustand";
import { computePerfTier, GOVERNOR_SLOW_FRAME_MS, shouldDropTier, type PerfTier } from "@/utils/perfTier";

export type { PerfTier } from "@/utils/perfTier";

type PerfState = { lowPower: boolean; governorDrops: number; governorRan: boolean };

const usePerfStore = create<PerfState>(() => ({ lowPower: false, governorDrops: 0, governorRan: false }));

let watchingPower = false;

// Low power mode (iOS) / battery saver (Android) drops every tier to low while it's on.
function watchPowerMode() {
  if (watchingPower) return;
  watchingPower = true;
  Battery.isLowPowerModeEnabledAsync()
    .then((lowPower) => usePerfStore.setState({ lowPower }))
    .catch(() => {});
  try {
    Battery.addLowPowerModeListener(({ lowPowerMode }) => usePerfStore.setState({ lowPower: lowPowerMode }));
  } catch {
    // Battery module missing (older build): no low-power signal.
  }
}

function tierFor(state: PerfState): PerfTier {
  return computePerfTier({
    os: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other",
    totalMemory: Device.totalMemory,
    apiLevel: Platform.OS === "android" ? (Platform.Version as number) : null,
    yearClass: Device.deviceYearClass,
    lowPower: state.lowPower,
    governorDrops: state.governorDrops,
  });
}

/** How much animation and resolution this phone can take right now: "high" looks exactly as designed. */
export function usePerfTier(): PerfTier {
  useEffect(watchPowerMode, []);
  return usePerfStore(tierFor);
}

/** The current tier outside React (services). */
export function getPerfTier(): PerfTier {
  watchPowerMode();
  return tierFor(usePerfStore.getState());
}

const GOVERNOR_DELAY_MS = 3000;
const GOVERNOR_WINDOW_MS = 2000;

/** Once per session, samples UI-thread frame times for ~2 s while `active`; a slow median drops one tier. */
export function usePerfGovernor(active: boolean) {
  const slow = useSharedValue(0);
  const total = useSharedValue(0);
  const sampler = useFrameCallback((frame) => {
    "worklet";
    const dt = frame.timeSincePreviousFrame;
    if (dt == null) return;
    total.value += 1;
    if (dt > GOVERNOR_SLOW_FRAME_MS) slow.value += 1;
  }, false);

  useEffect(() => {
    if (!active || usePerfStore.getState().governorRan) return;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const startTimer = setTimeout(() => {
      slow.value = 0;
      total.value = 0;
      sampler.setActive(true);
      stopTimer = setTimeout(() => {
        sampler.setActive(false);
        const drop = shouldDropTier(slow.value, total.value);
        usePerfStore.setState((s) => ({ governorRan: true, governorDrops: s.governorDrops + (drop ? 1 : 0) }));
      }, GOVERNOR_WINDOW_MS);
    }, GOVERNOR_DELAY_MS);
    return () => {
      clearTimeout(startTimer);
      if (stopTimer) clearTimeout(stopTimer);
      sampler.setActive(false);
    };
  }, [active, sampler, slow, total]);
}
