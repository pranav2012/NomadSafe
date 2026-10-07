import { useEffect, useEffectEvent, useRef } from "react";
import { AppState } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { SESSION_TIMEOUT_MS } from "@/modules/ads";
import { track } from "@/modules/analytics";
import { storage } from "@/modules/storage";
import { OVERVIEW, useMoneyViewStore } from "@/features/expenses/store/moneyViewStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { INITIAL_LANDING, nextLanding, type LandingSession, type LandingState } from "@/utils/landing";

const STATE_KEY = "landing-state";
const SESSION_KEY = "landing-session";
const QUICK_EXIT_MS = 5000;
const MONEY_PATH = "/expenses";
const EMPTY_SESSION: LandingSession = { hadTrip: false, visitedMoney: false, landedOnMoney: false, leftMoneyQuickly: false };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Where a new session opens (launch, or back after 30 min away): Home during a trip; with no trip,
 * Money once the user's habit says so (`nextLanding`). Links and notifications that already opened a
 * screen win: the app only moves off Home. Mount once inside the tabs layout.
 */
export function useLandingTab() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const session = useRef<LandingSession>(EMPTY_SESSION);
  const landedAt = useRef<number | null>(null);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const save = (next: LandingSession) => {
    session.current = next;
    storage.set(SESSION_KEY, JSON.stringify(next));
  };

  const startSession = useEffectEvent(() => {
    const state = nextLanding(read<LandingState>(STATE_KEY, INITIAL_LANDING), read<LandingSession>(SESSION_KEY, EMPTY_SESSION));
    storage.set(STATE_KEY, JSON.stringify(state));
    useMoneyViewStore.getState().resetUsed();
    const hasTrip = useTripsStore.getState().activeTripId !== null;
    const toMoney = !hasTrip && state.landOnMoney && pathRef.current === "/";
    landedAt.current = toMoney ? Date.now() : null;
    save({ ...EMPTY_SESSION, hadTrip: hasTrip, landedOnMoney: toMoney, visitedMoney: toMoney });
    track("app_landing", { tab: toMoney ? "money" : pathRef.current === "/" ? "home" : "other", reason: hasTrip ? "trip" : pathRef.current !== "/" ? "link" : "habit" });
    if (toMoney) {
      useMoneyViewStore.getState().select(OVERVIEW);
      useMoneyViewStore.getState().resetUsed();
      router.navigate("/(tabs)/expenses");
    }
  });

  useEffect(() => {
    startSession();
    let backgroundAt: number | null = null;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") backgroundAt = Date.now();
      if (next === "active" && backgroundAt !== null && Date.now() - backgroundAt >= SESSION_TIMEOUT_MS) startSession();
      if (next === "active") backgroundAt = null;
    });
    return () => subscription.remove();
  }, []);

  const activeTripId = useTripsStore((state) => state.activeTripId);
  useEffect(() => {
    const current = session.current;
    let next = current;
    if (activeTripId && !current.hadTrip) next = { ...next, hadTrip: true };
    if (pathname === MONEY_PATH && !current.visitedMoney) next = { ...next, visitedMoney: true };
    if (pathname !== MONEY_PATH && landedAt.current !== null) {
      const quick = Date.now() - landedAt.current < QUICK_EXIT_MS && !useMoneyViewStore.getState().used;
      landedAt.current = null;
      if (quick) next = { ...next, leftMoneyQuickly: true };
    }
    if (next !== current) save(next);
  }, [pathname, activeTripId]);
}
