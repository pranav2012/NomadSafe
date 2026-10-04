# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NomadSafe is a travel safety and planning app built with Expo (SDK 57), React Native 0.86 and React 19.2, in strict TypeScript. It launches on Google Play first; iOS comes later.

## Commands

- **Install deps**: `pnpm install` (package manager is **pnpm**, not npm or yarn)
- **Start dev server**: `pnpm start`
- **Run on Android / iOS**: `pnpm android` / `pnpm ios`. These need a dev-client build; the app doesn't run in Expo Go.
- **Lint**: `pnpm lint`
- **Type-check**: `pnpm exec tsc --noEmit`
- **Tests**: `pnpm test` (node:test + esbuild: expense import/parser, expense splits/voice parsing, trip utils, AI money facts, sync hashing, place opening hours, plans/trip limit, AI policy and provider adapters, ad frequency rules)
- **i18n check**: `node scripts/check-i18n-keys.mjs`
- **Backend**: `npx convex dev`
- **Release**: see `docs/PLAY_RELEASE.md` (EAS profiles are in `eas.json`)

## Architecture

The code is split into three layers. ESLint (`no-restricted-imports` in `eslint.config.js`) enforces the boundaries.

- **`src/atoms/`**: generic, reusable UI primitives (Aura buttons, fields, lists, chips, `AuraSheet` (the one bottom sheet), `AuraOptionSheet`, `AuraAlert` (`showAlert` / `showToast`, which replace the native `Alert`), `AuraOrb`, motion helpers, icons, tab bar). Import them from `@/atoms`, never deep paths. Only generic primitives belong here; components with feature knowledge stay in their feature.
- **`src/modules/<name>/`**: infrastructure, each the single source of truth for one concern and the only place its SDK is imported. Import from `@/modules/<name>` (its `index.ts`) only.

  | Module | Owns | Wraps |
  |---|---|---|
  | `ai` | All AI: `aiService` (chat + structured tasks), model download/lifecycle (`aiRuntime`), your-own-key config, availability hooks. **`policy.ts` decides which providers each task may use, and in what order**; change AI behaviour there | llama.rn, provider APIs, the Convex cloud endpoint |
  | `backend` | Convex client, `api`, React hooks (`useQuery`/`useMutation`/`useAction`), `BackendProvider`, Better Auth client, JWT exchange and HTTP client for background tasks | `convex/*`, `@convex-dev/*`, `@convex/_generated` |
  | `billing` | RevenueCat, plan store and rules (`usePlan`, `useStartNewTrip`, `FREE_TRIP_LIMIT`), `BillingEffects` | `react-native-purchases` |
  | `ads` | AdMob interstitial after creating a trip (free plan only, 4 h cap, first trip skipped), UMP consent, `AdsEffects` | `react-native-google-mobile-ads` |
  | `analytics` | PostHog events, flags, session replay, `<PrivateView>` (hides content from recordings) | `posthog-react-native` |
  | `logger` | Logging (`logger`) | PostHog Logs |
  | `storage` | Encrypted MMKV (`storage`, `mmkvStateStorage`), `secureStore`, `credentials` (keychain) | `react-native-mmkv`, `expo-secure-store`, `react-native-keychain` |
  | `notifications` | Permissions, channels, local notifications, push token, tap handling | `expo-notifications` |
  | `location` | Permissions, positions, geocoding, background updates (`defineLocationTask`), `MapView`/`Marker`/`Polyline` (react-native-maps is loaded lazily so headless tasks stay light) | `expo-location`, `react-native-maps`, `expo-task-manager` |

  To swap a vendor, change only its module. Modules may import other modules and feature stores; features never import a module's internals.
- **`src/features/<name>/{screens,components,hooks,services,store,utils}`**: product features (screens, feature components, stores and feature logic). `src/app/` route files are thin re-exports of feature screens. App-wide helpers that aren't infrastructure live in `src/constants` (design tokens, legal URLs), `src/utils`, `src/hooks` and `src/providers`.
- **Entry**: `index.ts` imports the background-task files (`features/location-sharing/services/locationBroadcastTask`, `@/modules/ai/background`) and registers the Android widget handler before `expo-router/entry`, so Android can run them on a headless launch. New background tasks must be imported there, through a light entry file rather than a whole module.
- **Routing**: Expo Router.
  - `src/app/_layout.tsx` contains the providers, `ErrorBoundary` (reports to PostHog), `AppStateLock` (auto-lock timer), `LockGate` (the PIN/biometric lock, an RN `Modal` over every route), `SessionEffects`, `BillingEffects`, `AdsGate`/`AdsEffects` and `AuraAlertHost`.
  - `AuraAlertHost` is mounted last so dialogs show above the lock screen.
- **Path aliases**: `@/` → `./src/`, `@convex/` → `./convex/`.
- **State**: zustand stores persisted to **encrypted MMKV** (`@/modules/storage`: AES-256, with the key in the Keystore/Keychain). No other MMKV instances.
- **Backend**: Convex + Better Auth (Google sign-in only).
  - `convex/users.ts`: auth helpers; user lookups go through the Better Auth component.
  - `convex/sharing.ts`: contact links, invites, location shares.
  - `convex/account.ts`: account deletion. It also schedules `convex/analytics.ts` to delete the user's PostHog data (needs `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` Convex env vars).
  - `convex/legalPages.ts`: `/privacy` and `/delete-account` pages.
  - `convex/groupTrips.ts`: shared trips (`sharedTrips`, `tripMembers`, `tripRecords`), invite codes, membership checks; `convex/tripNotifications.ts` sends Expo pushes for money changes and stores `pushTokens`. `/join/<code>` (in `legalPages.ts`) opens `nomadsafe://join/<code>`.
  - `convex/safetyAlerts.ts`: SOS / missed check-in pushes to the user's accepted `contactLinks` (the people who get their live location). The app mirrors the check-in deadline with `setCheckIn` (`features/safety/services/safetyServerAlerts.ts`, from `useSafetyServerSync`); a scheduled job alerts contacts 5 min after it passes. Clearing or moving it after an alert, and `resolveSos`, send an "is safe" push.
  - `convex/billing.ts`: the `entitlements` table, filled from the RevenueCat REST API by the webhook (`/revenuecat/webhook`) and `refreshMyPlan`. Pure plan/quota rules are in `convex/billingRules.ts`.
  - `convex/ai.ts`: Pro cloud AI (`gpt-6-luna`). `complete` (structured tasks) and the streamed `/ai/chat` HTTP action check the plan, a rate limit and the monthly `aiUsage` quota; the client passes the task id, and `aiUsage.byTask` keeps per-feature counts (never content) for `myUsage` and the Settings usage sheet. The phone keeps its own log of online AI uses (feature, provider, time) in `src/modules/ai/usageLog.ts`, cleared on sign-out/wipe.
  - `convex/sync.ts`: trip backup (`syncRecords`, last-write-wins by `updatedAt`, per-user `serverSeq` pull cursor, tombstones for deletes).
- **Trip backup**: `features/sync/services/syncEngine.ts` syncs trips, expenses, settlements and itinerary events to the account while signed in with `cloudBackupEnabled`. It diffs the stores against a per-user ledger in MMKV, so store actions don't need sync hooks. `rawText` never leaves the device. Sign-out clears backed-up data from the phone; data from another account is cleared on sign-in, unowned data is adopted. Stop the engine before resetting those stores, or the reset is pushed as deletions.
- **Shared trips**: `features/sync/services/groupSync.ts` mirrors `groupTrips.myTrips` (a live Convex subscription) into the trips store (`Trip.shared`, local id `g-<serverId>`) and syncs each trip's group expenses (split, or paid by someone else), settlements and itinerary. Splits use member ids on the server and `SELF_ID`/member names locally; names are unique per trip and never renamed. Unsplit expenses on a shared trip stay in the personal backup. Invite links are held in `pendingJoinStore` until the user is in the app. Archiving is per member; owners can delete only after everyone who joined is removed; members leave only when settled up.
- **Background location**: `features/location-sharing/services/locationBroadcastTask.ts` (a `defineLocationTask` from `@/modules/location`) gets a Convex JWT and an HTTP client from `@/modules/backend` and calls `sharing.publishLocation`. Its state is kept under its own MMKV key, not the UI store.
- **Plans**: Free (2 owned trips; joined shared trips don't count), Plus (unlimited trips; monthly, yearly or lifetime) and Pro (Plus + cloud AI), sold through RevenueCat (`@/modules/billing`; the paywall UI is `features/billing`). The app gates on RevenueCat's cached `CustomerInfo` (`planStore`); start new trips through `useStartNewTrip()`. Paid plans are ad-free; the free plan gets an AdMob interstitial after creating a trip (`@/modules/ads`). `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY` (RevenueCat Test Store) replaces the store key in development (`__DEV__`) builds only; the SDK closes release builds that use it. See `docs/MONETIZATION_PLAN.md`.
- **AI**: features call `aiService` from `@/modules/ai`, never a provider directly. `src/modules/ai/policy.ts` (`AI_TASK_ROUTES`) gives each task its providers in order: today the user's own key (direct from the phone, key in SecureStore), then NomadSafe Cloud (Pro), then the on-device model. `expenseCategory` is on-device only, because Gmail and SMS text must never go online. Online AI also requires Settings → Online AI and a connection. Prompts and output parsers are in `prompts.ts`, JSON schemas in `schemas.ts`. Only the on-device chat prompt may say replies stay on the phone.
- **Local AI**: llama.rn, managed by `src/modules/ai/local/localModelService.ts` (features use `aiRuntime`). All completions go through its internal queue, and `release()` is safe to call at any time.
- **Splits**: `Expense.paidBy` / `Expense.shares` (person ids: `SELF_ID` or a companion name) and `Settlement` records in the expenses store. Split math, balances and debt simplification are pure functions in `features/expenses/utils/split.ts`; amounts are handled in currency minor units.
- **Voice expenses**: `/voice-expense` (`VoiceExpenseScreen`) uses on-device speech only (`useSpeechCapture`: Android 13+ on-device recognizer, iOS `requiresOnDeviceRecognition`; no network fallback). The model only extracts fields (`aiService.extractVoiceExpense`, JSON schema; the transcript text goes online when online AI is in use, never audio); `interpretVoiceExtraction` resolves names and does no arithmetic by the model. Voice needs some AI route (on-device model or online AI). The route is the one exception to `LockGate`: it works while PIN-locked and must never show the ledger or balances.
- **SOS**: apps can't send SMS silently (no `SEND_SMS` on Play, none on iOS), so the SMS is always a pre-filled composer; the automatic alert is the server push above. The SOS widget opens `nomadsafe://sos?trigger=widget`, which `+native-intent` turns into a request in `quickSosStore`; the Safety tab then runs the same 5 s cancel countdown as the hold button. The Safety tab skips `LockGate` only while that countdown or an SOS is on screen.
- **Widgets**: Android uses `react-native-android-widget` (JS handler registered in `index.ts`, reads the stores directly), with a voice expense widget and an SOS widget. Widget files start with `"use no memo"`: the library calls them as plain functions, and React Compiler hooks break them (the widget renders transparent). Picker previews are in `assets/widgets/`. iOS is a Swift WidgetKit target in `targets/widget/` (`@bacons/apple-targets`, iOS 17+; both widgets are in the `WidgetBundle` in `SosWidget.swift`) that reads trip ids/names from the `group.com.pranav.NomadSafe` App Group, written by `features/widget/syncWidgets.ts`. Share nothing but trip ids, names and UI labels there.
- **Analytics**: PostHog (EU), in `@/modules/analytics`. It's off when `EXPO_PUBLIC_POSTHOG_KEY` is unset and in `__DEV__`. Add events to `AnalyticsEvents` and flags to `FeatureFlags` before using them. Event properties are counts, enums and booleans only, never user content or coordinates. Session replay is started and stopped by the app (off during PIN entry). Wrap new maps or sensitive views in `<PrivateView>`.
- **Errors and logs**: PostHog error tracking (JS, Android JVM + NDK, iOS crashes) and PostHog Logs; there is no Sentry. Log through `logger` from `@/modules/logger`, not `console.*`: it prints in dev and sends to PostHog in production, so attributes follow the analytics rules (no user content). `logger.error` also creates an exception. Release builds upload source maps and native symbols through the `posthog-react-native/expo` plugin and need the `POSTHOG_CLI_*` EAS env vars.
- **i18n**: `useLocalization().t` in components and `translate()` from `@/localization/translate` elsewhere. Add strings to `en.json`, and add their translations to the other locale files in `src/localization/translations/` (a missing key falls back to English). `node scripts/check-i18n-keys.mjs` lists keys used in code but missing from `en.json`. Counts use plural variants: `t("ns.key", { count })` picks `ns.key_one` / `ns.key_other`.
- **React Compiler caveat**: don't render values read from mutable module caches (e.g. the exchange-rate Map); the compiler memoizes them and they never update. Keep rendered values in state or stores.

## Play Store constraints (don't regress)

- Never add `READ_SMS`, `SEND_SMS` or other restricted permissions. They're listed in `android.blockedPermissions`, and SOS uses the SMS composer (`expo-sms`).
- Show `BackgroundLocationDisclosure` before any `requestBackgroundPermissionsAsync()`.
- `RECORD_AUDIO` is allowed only for on-device voice entry; never add a network speech fallback.
- Keep privacy copy truthful. Online AI requests go to OpenAI via Convex (Pro) or the user's own provider; purchases go to RevenueCat; the free plan's ads go through Google AdMob (advertising ID, approximate location, ad interactions; EU/UK consent via UMP first). Account, live location, the trip backup (trips, expenses, settlements, itinerary; not raw imported text), shared trips (visible to their members), check-in end times / SOS times, the plan and monthly AI usage counts (per feature, no content) and push tokens go to Convex; push notification text goes through Expo/FCM/APNs; everything else stays on the device. Don't claim end-to-end encryption. Update the Play data safety form when this changes.
- Account deletion must keep working in the app (Settings) and on the web (`/delete-account`).

## Key Config

- New Architecture only; the React Compiler is enabled; typed routes are enabled.
- Package / bundle IDs: Android `com.pranav.nomadsafe`, iOS `com.pranav.NomadSafe`.
- Push: Android uses FCM via `google-services.json` (FCM v1 key in EAS). iOS push is stripped by `plugins/withoutPushEntitlement.js` unless `IOS_PUSH_ENABLED=1` (needs a paid Apple team + APNs key in EAS).
- `android.allowBackup: false`. R8 minify and resource shrinking are on (keep rules for llama.rn, Nitro, Skia, Expo's headless app loader and Google's consent SDK are in `app.json`; anything loaded by class name needs one).
- Production builds strip `console.log/info/debug` (`babel.config.js`).
- ESLint uses a flat config extending `eslint-config-expo`, plus the module/atoms import boundaries.
- App config is static on purpose: `eas build` compares a runtime fingerprint computed locally with the one on EAS, so config must not depend on env vars that differ between them (see `plugins/withLlamaMemoryEntitlements.js`).
