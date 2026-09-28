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
- **Tests**: `pnpm test` (node:test + esbuild: expense import/parser, trip utils, AI money facts)
- **i18n check**: `node scripts/check-i18n-keys.mjs`
- **Backend**: `npx convex dev`
- **Release**: see `docs/PLAY_RELEASE.md` (EAS profiles are in `eas.json`)

## Architecture

- **Entry**: `index.ts` imports the background-task modules (location broadcast, model download) before `expo-router/entry`, so Android can run them on a headless launch. New `TaskManager.defineTask` modules must be imported there.
- **Routing**: Expo Router, with routes in `src/app/`. Route files are thin re-exports of feature screens.
  - `src/app/_layout.tsx`: providers, Sentry, `ErrorBoundary`, `AppStateLock` (auto-lock timer), `LockGate` (the PIN/biometric lock as an RN `Modal` over every route) and `SessionEffects`.
- **Features**: `src/features/<name>/{screens,components,hooks,services,store,utils}`
- **Path aliases**: `@/` → `./src/`, `@convex/` → `./convex/`
- **State**: zustand stores persisted to **encrypted MMKV** (`src/stores/storage.ts`, AES-256, key in Keystore/Keychain via SecureStore). No other MMKV instances.
- **Backend**: Convex + Better Auth (Google sign-in only).
  - `convex/users.ts`: auth helpers; user lookups go through the Better Auth component.
  - `convex/sharing.ts`: contact links, invites, location shares.
  - `convex/account.ts`: account deletion.
  - `convex/legalPages.ts`: `/privacy` and `/delete-account` pages.
- **Background location**: `features/location-sharing/services/locationBroadcastTask.ts` exchanges the Better Auth session cookie for a Convex JWT and calls `sharing.publishLocation` with `ConvexHttpClient`. Its state is kept under its own MMKV key, not the UI store.
- **Local AI**: llama.rn, managed by `features/ai/services/localModelService.ts`. All completions go through its internal queue, and `release()` is safe to call at any time.
- **i18n**: `useLocalization().t` in components and `translate()` from `@/localization/translate` elsewhere. Add strings to `en.json`, and add their translations to the other locale files in `src/localization/translations/` (a missing key falls back to English). `node scripts/check-i18n-keys.mjs` lists keys used in code but missing from `en.json`. Counts use plural variants: `t("ns.key", { count })` picks `ns.key_one` / `ns.key_other`.
- **React Compiler caveat**: don't render values read from mutable module caches (e.g. the exchange-rate Map); the compiler memoizes them and they never update. Keep rendered values in state or stores.

## Play Store constraints (don't regress)

- Never add `READ_SMS`, `SEND_SMS` or other restricted permissions. They're listed in `android.blockedPermissions`, and SOS uses the SMS composer (`expo-sms`).
- Show `BackgroundLocationDisclosure` before any `requestBackgroundPermissionsAsync()`.
- Keep privacy copy truthful. Account and live location go to Convex; everything else stays on the device. Don't claim end-to-end encryption.
- Account deletion must keep working in the app (Settings) and on the web (`/delete-account`).

## Key Config

- New Architecture only; the React Compiler is enabled; typed routes are enabled.
- Package / bundle IDs: Android `com.pranav.nomadsafe`, iOS `com.pranav.NomadSafe`.
- `android.allowBackup: false`. R8 minify and resource shrinking are on (keep rules for llama.rn and Nitro are in `app.json`).
- Production builds strip `console.log/info/debug` (`babel.config.js`).
- ESLint uses a flat config extending `eslint-config-expo`.
