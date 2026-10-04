# Plans, paywall and online AI

## Tiers

| | Free (forever) | Plus | Pro |
|---|---|---|---|
| Trips you own | 2 (joining someone else's shared trip is always free) | Unlimited | Unlimited |
| Features | Everything | Everything | Everything |
| AI | On-device model + your own API key | On-device model + your own API key | GPT-6 Luna when online (monthly quota), on-device model as fallback, your own key first |
| Ads | Occasional interstitial (see Ads) | None | None |
| Billing | – | Monthly, yearly or lifetime | Monthly or yearly, with a 3-day free trial |

"Trips you own" counts personal trips and shared trips where the user is the owner (`Trip.shared.role === "owner"`). Deleting a trip frees its slot. The app isn't live yet, so there's no grandfathering.

## AI routing

For every AI task (chat, chat memory, budget estimate, trip name, itinerary refine, expense category, voice extraction):

1. Online, with **Online AI** on in Settings: the user's own key (if set), then NomadSafe Cloud (Pro, within quota).
2. Otherwise, or when the online calls fail: the on-device model.

Voice expenses use online AI too. Only the transcribed text is sent, never audio; speech recognition stays on-device (no network speech fallback, per the Play constraint).

## Billing (RevenueCat)

- SDK: `react-native-purchases`. The app user id is the Better Auth user id (`Purchases.logIn` on sign-in, `logOut` on sign-out).
- Entitlements: `unlimited_trips` (Plus and Pro) and `cloud_ai` (Pro).
- Offering `default` with these package identifiers:

| Package | Play product | Grants |
|---|---|---|
| `plus_monthly` | subscription `plus`, base plan `monthly` | `unlimited_trips` |
| `plus_annual` | subscription `plus`, base plan `annual` | `unlimited_trips` |
| `plus_lifetime` | one-time product `plus_lifetime` | `unlimited_trips` |
| `pro_monthly` | subscription `pro`, base plan `monthly` + free-trial offer | `unlimited_trips`, `cloud_ai` |
| `pro_annual` | subscription `pro`, base plan `annual` + free-trial offer | `unlimited_trips`, `cloud_ai` |

- iOS uses the same product and package ids. In App Store Connect, `plus` and `pro` are one subscription group, with Pro ranked above Plus so Apple handles upgrades and downgrades, and `plus_lifetime` is a non-consumable. The Pro trial is a 3-day free introductory offer; the paywall shows it only when `checkTrialOrIntroductoryPriceEligibility` says this Apple ID can still use it. On iOS the paywall also links Apple's standard EULA, which App Review requires next to auto-renewing subscriptions.
- The free trial is a 3-day Play Console offer on the Pro base plans (3 days is the shortest Play allows). The app reads the length from the product, so changing it needs no code change. The paywall shows it when the package has a free phase.
- The app gates features from the SDK's cached `CustomerInfo`, which also works offline. The server keeps its own copy in the `entitlements` table, filled from the RevenueCat REST API:
  - by the webhook at `POST /revenuecat/webhook`;
  - by `billing.refreshMyPlan`, which the app calls after a purchase or restore.

## Ads (Free plan)

- Google AdMob through `react-native-google-mobile-ads`, wrapped by `src/modules/ads` (nothing else imports the library).
- **Who sees ads:** Free only. Any paid plan (`unlimitedTrips` in the plan store, so Plus monthly/yearly/lifetime and Pro) never starts the consent flow or the SDK. Upgrading mid-session drops the preloaded ad and stops loading (the SDK can't be shut down until the next launch, but it requests nothing).
- **Placement:** one interstitial, shown after a *new* trip is saved (`TripForm` → `showTripCreatedAd()`), fire and forget, about 0.6 s after the planner closes and only if the app is active. Never on safety flows (SOS, check-in, live location, lock screen, voice capture).
- **Frequency:** at most once every 4 hours (`ads:lastShownAt` in MMKV) and never for the user's first trip ever on this install (`ads:firstTripCreated`). Free users own at most 2 trips, so in practice this is the second trip and later ones after deleting a trip.
- **Consent:** `AdsGate` in `src/app/_layout.tsx` starts ads only when the user is in the app, unlocked and not on SOS or voice capture. `AdsConsent.gatherConsent()` (UMP) runs once per launch; `mobileAds().initialize()` runs once, as soon as `canRequestAds` is true (from this session's form or a previous one). Where GDPR applies and the user didn't consent to personalised ads, requests are non-personalised. When UMP requires privacy options, Settings shows **Ad privacy choices** (`showPrivacyOptionsForm`).
- **IDs:** AdMob app IDs are static in `app.json` (currently Google's sample IDs; replace before production, see `docs/PLAY_RELEASE.md` step 12). Interstitial unit ids come from `EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID` / `EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_ID`; dev builds and builds without them use `TestIds.INTERSTITIAL`.
- **Analytics:** `ad_shown` and `ad_failed` (`placement`, `stage`), enums only.

## NomadSafe Cloud AI (Pro)

- `convex/ai.ts`. JSON tasks go through the `ai.complete` action; chat streams from `POST /ai/chat` (Convex JWT as Bearer).
- Calls OpenRouter's chat completions API (`OPENROUTER_API_KEY`). The model is the `CLOUD_AI_MODEL` Convex env var (default `openai/gpt-6-luna`), so it can change without a deploy. Every request sets `provider.data_collection = "deny"` and `require_parameters`. Monthly quota in `aiUsage`: `CLOUD_AI_LIMITS` (300 chat replies, 1,500 small tasks). There's also a per-user rate limit.
- When the quota runs out, the app falls back to the on-device model until next month.

## Bring your own key

- Providers:
  - OpenAI (default `gpt-6-luna`).
  - Anthropic (default `claude-opus-5-5`).
  - Google Gemini (default `gemini-3.8-flash`).
  - Any OpenAI-compatible endpoint, such as OpenRouter.
- The key is stored in SecureStore, never synced, and cleared by sign-out and wipe. Requests go straight from the phone to the provider.

## Setup checklist

- **RevenueCat:** create a project, connect the Play app, and add the entitlements and offering above.
- **App env:** set `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (and `EXPO_PUBLIC_REVENUECAT_IOS_KEY` later) in EAS env and `.env.local`.
- **App Store Connect (iOS):** paid Apple Developer Program and the Paid Apps agreement; a subscription group with the `plus` and `pro` monthly and annual plans (Pro ranked higher, 3-day free intro offer on both Pro plans) and a non-consumable `plus_lifetime`; an In-App Purchase key uploaded to a RevenueCat App Store app that uses the same entitlements and packages.
- **Play Console:** create the subscriptions `plus` and `pro` (monthly and annual base plans), the one-time product `plus_lifetime`, and a 3-day free-trial offer (new customers) on both `pro` base plans.
- **Convex env:**
  - `REVENUECAT_SECRET_API_KEY` (v1 secret key).
  - `REVENUECAT_WEBHOOK_AUTH`: any long random string. Set the same value as the webhook's Authorization header in RevenueCat.
  - `OPENROUTER_API_KEY` (and optionally `CLOUD_AI_MODEL`).
- **RevenueCat webhook:** point it at `https://<deployment>.convex.site/revenuecat/webhook`.
- **AdMob:** see `docs/PLAY_RELEASE.md` step 12 (real app IDs, interstitial unit ids, consent message, app-ads.txt).
- **Play data safety form:** declare that chat messages, trip and money context and voice transcripts can go to OpenRouter and the model provider it routes to (Pro, via our server) or to the provider the user picks. Purchase history goes to RevenueCat/Google Play.
