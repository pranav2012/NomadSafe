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
- **Tests**: `pnpm test` (node:test + esbuild: expense import/parser, expense splits/voice parsing, trip utils, AI money facts)
- **i18n check**: `node scripts/check-i18n-keys.mjs`
- **Backend**: `npx convex dev`
- **Release**: see `docs/PLAY_RELEASE.md` (EAS profiles are in `eas.json`)

## Architecture

- **Entry**: `index.ts` imports the background-task modules (location broadcast, model download) before `expo-router/entry`, so Android can run them on a headless launch. New `TaskManager.defineTask` modules must be imported there.
- **Routing**: Expo Router, with routes in `src/app/`. Route files are thin re-exports of feature screens.
  - `src/app/_layout.tsx`: providers, `ErrorBoundary` (reports to PostHog), `AppStateLock` (auto-lock timer), `LockGate` (the PIN/biometric lock as an RN `Modal` over every route) and `SessionEffects`.
- **Features**: `src/features/<name>/{screens,components,hooks,services,store,utils}`
- **Path aliases**: `@/` → `./src/`, `@convex/` → `./convex/`
- **State**: zustand stores persisted to **encrypted MMKV** (`src/stores/storage.ts`, AES-256, key in Keystore/Keychain via SecureStore). No other MMKV instances.
- **Backend**: Convex + Better Auth (Google sign-in only).
  - `convex/users.ts`: auth helpers; user lookups go through the Better Auth component.
  - `convex/sharing.ts`: contact links, invites, location shares.
  - `convex/account.ts`: account deletion. It also schedules `convex/analytics.ts` to delete the user's PostHog data (needs `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` Convex env vars).
  - `convex/legalPages.ts`: `/privacy` and `/delete-account` pages.
- **Background location**: `features/location-sharing/services/locationBroadcastTask.ts` exchanges the Better Auth session cookie for a Convex JWT and calls `sharing.publishLocation` with `ConvexHttpClient`. Its state is kept under its own MMKV key, not the UI store.
- **Local AI**: llama.rn, managed by `features/ai/services/localModelService.ts`. All completions go through its internal queue, and `release()` is safe to call at any time.
- **Splits**: `Expense.paidBy` / `Expense.shares` (person ids: `SELF_ID` or a companion name) and `Settlement` records in the expenses store. Split math, balances and debt simplification are pure functions in `features/expenses/utils/split.ts`; amounts are handled in currency minor units.
- **Voice expenses**: `/voice-expense` (`VoiceExpenseScreen`) uses on-device speech only (`useSpeechCapture`: Android 13+ on-device recognizer, iOS `requiresOnDeviceRecognition`; no network fallback). The local model only extracts fields (`localModelService.extractVoiceExpense`, JSON schema); `interpretVoiceExtraction` resolves names and does no arithmetic by the model. Voice needs the local model. The route is the one exception to `LockGate`: it works while PIN-locked and must never show the ledger or balances.
- **Widgets**: Android uses `react-native-android-widget` (JS handler registered in `index.ts`, reads the stores directly). iOS is a Swift WidgetKit target in `targets/widget/` (`@bacons/apple-targets`, iOS 17+) that reads trip ids/names from the `group.com.pranav.NomadSafe` App Group, written by `features/widget/syncWidgets.ts`. Share nothing but trip ids, names and UI labels there.
- **Analytics**: PostHog (EU), in `src/services/analytics.ts`. It's off when `EXPO_PUBLIC_POSTHOG_KEY` is unset and in `__DEV__`. Add events to `AnalyticsEvents` and flags to `FeatureFlags` before using them. Event properties are counts, enums and booleans only, never user content or coordinates. Session replay is started and stopped by the app (off during PIN entry). Wrap new maps or sensitive views in `PostHogMaskView`.
- **Errors and logs**: PostHog error tracking (JS, Android JVM + NDK, iOS crashes) and PostHog Logs; there is no Sentry. Log through `logger` from `src/services/logger.ts`, not `console.*`: it prints in dev and sends to PostHog in production, so attributes follow the analytics rules (no user content). `logger.error` also creates an exception. Release builds upload source maps and native symbols through the `posthog-react-native/expo` plugin and need the `POSTHOG_CLI_*` EAS env vars.
- **i18n**: `useLocalization().t` in components and `translate()` from `@/localization/translate` elsewhere. Add strings to `en.json`, and add their translations to the other locale files in `src/localization/translations/` (a missing key falls back to English). `node scripts/check-i18n-keys.mjs` lists keys used in code but missing from `en.json`. Counts use plural variants: `t("ns.key", { count })` picks `ns.key_one` / `ns.key_other`.
- **React Compiler caveat**: don't render values read from mutable module caches (e.g. the exchange-rate Map); the compiler memoizes them and they never update. Keep rendered values in state or stores.

## Play Store constraints (don't regress)

- Never add `READ_SMS`, `SEND_SMS` or other restricted permissions. They're listed in `android.blockedPermissions`, and SOS uses the SMS composer (`expo-sms`).
- Show `BackgroundLocationDisclosure` before any `requestBackgroundPermissionsAsync()`.
- `RECORD_AUDIO` is allowed only for on-device voice entry; never add a network speech fallback.
- Keep privacy copy truthful. Account and live location go to Convex; everything else stays on the device. Don't claim end-to-end encryption.
- Account deletion must keep working in the app (Settings) and on the web (`/delete-account`).

## Key Config

- New Architecture only; the React Compiler is enabled; typed routes are enabled.
- Package / bundle IDs: Android `com.pranav.nomadsafe`, iOS `com.pranav.NomadSafe`.
- `android.allowBackup: false`. R8 minify and resource shrinking are on (keep rules for llama.rn and Nitro are in `app.json`).
- Production builds strip `console.log/info/debug` (`babel.config.js`).
- ESLint uses a flat config extending `eslint-config-expo`.
