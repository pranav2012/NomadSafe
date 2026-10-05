import { AppState, Platform } from "react-native";
import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  InterstitialAd,
  TestIds,
} from "react-native-google-mobile-ads";
import { create } from "zustand";
import { getFlagPayload, track } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { storage } from "@/modules/storage";
import { canShowAd, placementDue, pruneShows, resolveAdConfig, SESSION_TIMEOUT_MS, type AdPlacement } from "./rules";

const SHOWS_KEY = "ads:shownAt";
const INSTALLED_KEY = "ads:installedAt";
const SESSIONS_KEY = "ads:sessions";
const ACTIONS_KEY_PREFIX = "ads:actions:";
const FIRST_TRIP_KEY = "ads:firstTripCreated";
// Loaded interstitials expire after an hour.
const AD_MAX_AGE_MS = 55 * 60 * 1000;
const SHOW_DELAY_MS = 600;

const envUnitId = Platform.select({
  android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID,
  ios: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_ID,
});
const INTERSTITIAL_UNIT_ID = __DEV__ || !envUnitId ? TestIds.INTERSTITIAL : envUnitId;

interface AdsState {
  privacyOptionsRequired: boolean;
}

export const useAdsStore = create<AdsState>()(() => ({ privacyOptionsRequired: false }));

let enabled = false;
let consentStarted = false;
let sdkStart: Promise<void> | null = null;
let interstitial: InterstitialAd | null = null;
let loadedAt = 0;
let removeListeners: (() => void)[] = [];
let showingPlacement: AdPlacement | "preload" = "preload";
// Set while the user is on a screen where ads must never appear (SOS, voice capture, locked).
let suspended = false;
let sessionsTracked = false;
let sessionStartedAt = 0;
let shownThisSession = 0;
let backgroundedAt: number | null = null;

async function refreshConsentState(): Promise<boolean> {
  const info = await AdsConsent.getConsentInfo();
  useAdsStore.setState({
    privacyOptionsRequired:
      info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
  });
  return info.canRequestAds;
}

/** Initialises the SDK once, and only after UMP allows ad requests (this or a previous session). */
async function startSdk() {
  if (!(await refreshConsentState()) || !enabled) return;
  sdkStart ??= mobileAds()
    .initialize()
    .then(() => undefined);
  await sdkStart;
  preload();
}

/** Non-personalised ads unless the user consented to personalised ads where GDPR applies. */
async function personalisedAllowed(): Promise<boolean> {
  if (!(await AdsConsent.getGdprApplies())) return true;
  const choices = await AdsConsent.getUserChoices();
  return choices.selectPersonalisedAds;
}

function discardInterstitial() {
  removeListeners.forEach((remove) => remove());
  removeListeners = [];
  interstitial?.destroy();
  interstitial = null;
  loadedAt = 0;
}

function preload() {
  if (!enabled || !sdkStart) return;
  if (interstitial && Date.now() - loadedAt > AD_MAX_AGE_MS && interstitial.loaded) discardInterstitial();
  if (interstitial) {
    interstitial.load();
    return;
  }
  void personalisedAllowed()
    .catch(() => false)
    .then((personalised) => {
      if (!enabled || interstitial) return;
      const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
        requestNonPersonalizedAdsOnly: !personalised,
      });
      removeListeners = [
        ad.addAdEventListener(AdEventType.LOADED, () => {
          loadedAt = Date.now();
        }),
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          if (enabled) ad.load();
        }),
        ad.addAdEventListener(AdEventType.ERROR, (error) => {
          const stage = error.phase === "show" ? "show" : "load";
          track("ad_failed", { placement: stage === "show" ? showingPlacement : "preload", stage });
          logger.info("ads", "interstitial failed", { stage, reason: error.reason ?? null });
        }),
      ];
      interstitial = ad;
      ad.load();
    });
}

function startSession(now: number) {
  sessionStartedAt = now;
  shownThisSession = 0;
  storage.set(SESSIONS_KEY, (storage.getNumber(SESSIONS_KEY) ?? 0) + 1);
}

/** Counts sessions (launch, or back after 30 min in the background) for the grace period and session cap. */
function trackSessions() {
  if (sessionsTracked) return;
  sessionsTracked = true;
  const now = Date.now();
  if (storage.getNumber(INSTALLED_KEY) === undefined) storage.set(INSTALLED_KEY, now);
  startSession(now);
  AppState.addEventListener("change", (state) => {
    if (state === "background") backgroundedAt ??= Date.now();
    else if (state === "active") {
      if (backgroundedAt !== null && Date.now() - backgroundedAt >= SESSION_TIMEOUT_MS) startSession(Date.now());
      backgroundedAt = null;
    }
  });
}

function readShows(): number[] {
  try {
    const parsed: unknown = JSON.parse(storage.getString(SHOWS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((at): at is number => typeof at === "number") : [];
  } catch {
    return [];
  }
}

function recordShow(now: number) {
  shownThisSession += 1;
  storage.set(SHOWS_KEY, JSON.stringify([...pruneShows(readShows(), now), now]));
}

/** Free plan: gathers UMP consent, then starts the SDK and preloads. Safe to call repeatedly. */
export function startAds() {
  if (enabled) return;
  enabled = true;
  trackSessions();
  if (!consentStarted) {
    consentStarted = true;
    AdsConsent.gatherConsent()
      .then(() => startSdk())
      .catch((error: unknown) => logger.warn("ads", "consent failed", error));
  }
  startSdk().catch((error: unknown) => logger.warn("ads", "start failed", error));
}

/** Paid plan: drops the preloaded ad and stops loading more (the SDK can't be shut down). */
export function stopAds() {
  enabled = false;
  discardInterstitial();
  useAdsStore.setState({ privacyOptionsRequired: false });
}

/** Blocks showing ads while the user is on a safety, capture or locked screen. */
export function setAdsSuspended(value: boolean) {
  suspended = value;
}

/** True only the first time a trip is ever created on this install, so that trip never gets an ad. */
function consumeFirstTrip(): boolean {
  if (storage.getBoolean(FIRST_TRIP_KEY)) return false;
  storage.set(FIRST_TRIP_KEY, true);
  return true;
}

/**
 * Call after the user finishes an action at a natural break. Counts the action for the placement's
 * "every Nth" rule and shows the interstitial when the shared frequency rules allow it.
 * Fire and forget: never throws or waits on the ad.
 */
export function showInterstitial(placement: AdPlacement) {
  try {
    if (placement === "trip_created" && consumeFirstTrip()) return;
    if (!enabled || suspended) return;
    const config = resolveAdConfig(getFlagPayload("ad_frequency"));
    const actionsKey = ACTIONS_KEY_PREFIX + placement;
    const actions = (storage.getNumber(actionsKey) ?? 0) + 1;
    storage.set(actionsKey, actions);
    if (!placementDue(actions, config.every[placement])) return;

    const ad = interstitial;
    const allowed = canShowAd({
      now: Date.now(),
      config,
      installedAt: storage.getNumber(INSTALLED_KEY) ?? Date.now(),
      sessions: storage.getNumber(SESSIONS_KEY) ?? 0,
      sessionStartedAt,
      shownThisSession,
      recentShows: readShows(),
      loaded: !!ad?.loaded && Date.now() - loadedAt <= AD_MAX_AGE_MS,
    });
    if (!ad || !allowed) {
      preload();
      return;
    }
    setTimeout(() => {
      if (!enabled || suspended || interstitial !== ad || !ad.loaded || AppState.currentState !== "active") return;
      recordShow(Date.now());
      storage.set(actionsKey, 0);
      showingPlacement = placement;
      ad.show()
        .then(() => track("ad_shown", { placement }))
        .catch((error: unknown) => logger.info("ads", "interstitial not shown", { reason: error instanceof Error ? error.name : null }));
    }, SHOW_DELAY_MS);
  } catch (error) {
    logger.warn("ads", "show failed", error);
  }
}

/** Reopens the UMP form so the user can change their ad consent. */
export async function showAdPrivacyOptions() {
  try {
    await AdsConsent.showPrivacyOptionsForm();
    // Recreate the ad so the next request uses the new choices.
    discardInterstitial();
    await startSdk();
  } catch (error) {
    logger.warn("ads", "privacy options failed", error);
  }
}
