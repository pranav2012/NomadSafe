# Expense auto-import

The Money / Ledger screen (`src/features/expenses`) can add spends three ways:

1. **Paste** bank / UPI / card alerts (works everywhere, no setup).
2. **SMS inbox** scan (Android only, needs a native build — see below).
3. **Gmail** transactional emails (needs a Google OAuth client — see below).

All three feed the same pipeline: `transactionParser` extracts amount + merchant,
`categorizer` assigns a category (keyword heuristic first, local LLM for the rest),
and the review sheet lets the user deselect duplicates and fix categories before
saving. Spends are stored on-device in MMKV (`expensesStore`).

## Why paste works but SMS/email need setup

- **iOS cannot read SMS at all** — Apple exposes no API for it. `expo-sms` only
  _sends_. So SMS scan is Android-only by design.
- **Reading SMS on Android** needs a custom native module + the `READ_SMS`
  runtime permission, and only runs in a dev/release build (not Expo Go).
- **Email** has no OS permission; it requires Gmail's OAuth API.

The app detects what's available at runtime and falls back to paste, so nothing
breaks when SMS/Gmail aren't configured.

## Enabling Android SMS reading

A local Expo module is included at `modules/expo-sms-reader` (Kotlin). It is
autolinked but only compiled into a native build.

1. Rebuild the dev client (the JS service `smsImport.ts` auto-detects the module):
   ```bash
   pnpm build        # expo prebuild --clean
   pnpm android      # expo run:android
   ```
2. `READ_SMS` is already declared in `app.json` → `android.permissions`. The app
   requests it at runtime when the user taps **Scan SMS inbox**.

> Play Store note: `READ_SMS` is a restricted permission. Distributing this on the
> Play Store requires a permissions declaration / approved use case, or limiting
> the build to internal/sideloaded distribution. This does not affect dev builds.

## Enabling Gmail import

Uses `expo-auth-session` (Google provider) + the Gmail REST API
(`gmail.readonly` scope). Create OAuth client IDs in the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create an OAuth consent screen and add the `.../auth/gmail.readonly` scope.
2. Create OAuth client IDs for iOS, Android, and/or Web.
3. Add them to `.env.local` (read via `process.env.EXPO_PUBLIC_*`):
   ```
   EXPO_PUBLIC_GMAIL_IOS_CLIENT_ID=...apps.googleusercontent.com
   EXPO_PUBLIC_GMAIL_ANDROID_CLIENT_ID=...apps.googleusercontent.com
   EXPO_PUBLIC_GMAIL_WEB_CLIENT_ID=...apps.googleusercontent.com
   ```
   A **Web** client ID is currently configured.

When no client ID is set, the Gmail tab shows a "not configured" hint and the
other sources keep working. `isGmailConfigured()` gates the UI.

### Web client ID + redirect URIs (important)

A **Web** OAuth client only accepts `http(s)` redirect URIs — not custom app
schemes. So:

- It works cleanly on the **web** target and via the Expo auth proxy.
- For **native** dev/release builds, Google may return `redirect_uri_mismatch`.
  Add the redirect URI the app logs at runtime (or
  `https://auth.expo.io/@<expo-username>/NomadSafe` if using the proxy) to the
  client's **Authorized redirect URIs** in Google Cloud.
- For the smoothest native flow, also create **iOS** and **Android** client IDs
  (their custom-scheme redirects are tied to the bundle ID / package + SHA-1) and
  set `EXPO_PUBLIC_GMAIL_IOS_CLIENT_ID` / `..._ANDROID_CLIENT_ID`.
