# NomadSafe

A travel safety and planning app for Android (iOS later). It brings together trips and itineraries, expense tracking, SOS and check-ins, live location sharing with trusted contacts, and an on-device AI travel assistant.

Stack: Expo SDK 57 · React Native 0.86 · React 19.2 (React Compiler) · Expo Router · Convex + Better Auth · zustand + encrypted MMKV · llama.rn.

## Getting started

```bash
pnpm install
cp .env.example .env.local        # fill in the values
npx convex dev                    # backend (separate terminal)
pnpm android                      # dev client build + run on a device or emulator
```

This app uses native modules (llama.rn, MMKV, Maps), so it **won't run in Expo Go**. Use a dev-client build (`pnpm android` or `eas build --profile development`).

## Scripts

| Command | What it does |
|---|---|
| `pnpm start` | Metro dev server |
| `pnpm android` / `pnpm ios` | Build and run the dev client |
| `pnpm lint` | ESLint |
| `pnpm exec tsc --noEmit` | Type-check |
| `pnpm test:expense-import` | Transaction parser / import tests |
| `node scripts/check-i18n-keys.mjs` | Lists `t("…")` keys missing from `en.json` |
| `pnpm localize` | Generates the other 14 locales from `en.json` |

## Project layout

- `src/app/`: Expo Router routes (thin wrappers around feature screens)
- `src/features/<feature>/`: screens, components, hooks, services and stores per feature
- `src/localization/`: i18n provider, `translate()` for code outside React, translations
- `src/stores/storage.ts`: the encrypted MMKV instance shared by every store
- `convex/`: backend (auth, sharing, account deletion, privacy and deletion web pages)
- `index.ts`: app entry. Defines background tasks before the router loads.
- `docs/PLAY_RELEASE.md`: Play Store release runbook

## Releasing

See [`docs/PLAY_RELEASE.md`](docs/PLAY_RELEASE.md).
