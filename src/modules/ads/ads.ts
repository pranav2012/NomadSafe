import { AppState, Platform } from "react-native";
import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  InterstitialAd,
  TestIds,
} from "react-native-google-mobile-ads";
import { create } from "zustand";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { storage } from "@/modules/storage";
import { canShowAd } from "./rules";

const LAST_SHOWN_KEY = "ads:lastShownAt";
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
          track("ad_failed", { placement: "trip_created", stage });
          logger.info("ads", "interstitial failed", { stage, reason: error.reason ?? null });
        }),
      ];
      interstitial = ad;
      ad.load();
    });
}

/** Free plan: gathers UMP consent, then starts the SDK and preloads. Safe to call repeatedly. */
export function startAds() {
  if (enabled) return;
  enabled = true;
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

/** Shows the interstitial after a new trip when allowed; never throws or waits on the ad. */
export function showTripCreatedAd() {
  try {
    const firstTrip = !storage.getBoolean(FIRST_TRIP_KEY);
    if (firstTrip) storage.set(FIRST_TRIP_KEY, true);
    if (!enabled) return;
    const ad = interstitial;
    const allowed = canShowAd({
      now: Date.now(),
      lastShownAt: storage.getNumber(LAST_SHOWN_KEY) ?? null,
      firstTrip,
      loaded: !!ad?.loaded && Date.now() - loadedAt <= AD_MAX_AGE_MS,
    });
    if (!ad || !allowed) {
      preload();
      return;
    }
    setTimeout(() => {
      if (!enabled || interstitial !== ad || !ad.loaded || AppState.currentState !== "active") return;
      storage.set(LAST_SHOWN_KEY, Date.now());
      ad.show()
        .then(() => track("ad_shown", { placement: "trip_created" }))
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
