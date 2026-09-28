# Expense auto-import

The Money / Ledger screen (`src/features/expenses`) can add spends two ways:

1. **Paste** bank / UPI / card alerts (works everywhere, no setup).
2. **Gmail** transactional emails (needs a Google OAuth client — see below).

Both feed the same pipeline: `transactionParser` extracts amount + merchant,
`categorizer` assigns a category (keyword heuristic first, local LLM for the rest),
and the review sheet lets the user deselect duplicates and fix categories before
saving. Spends are stored on-device in MMKV (`expensesStore`).

There is no SMS inbox import. `READ_SMS` is a restricted Play permission and is
listed in `android.blockedPermissions`, so users paste SMS alerts instead.

When Gmail isn't configured, the Gmail tab shows a "not configured" hint and
paste keeps working.

## Enabling Gmail import

Uses `expo-auth-session` (Google provider) + the Gmail REST API
(`gmail.readonly` scope). This is a separate OAuth grant from the app's Better
Auth sign-in. The signed-in email is passed as `login_hint` so Google
pre-selects that account, but the user can pick another one.

Create OAuth client IDs in the
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

`isGmailConfigured()` gates the UI.

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
- The Android client's SHA-1 must be the **Play App Signing** key (Play Console →
  App integrity), not the upload or debug key, or sign-in fails for Play installs.

## Production verification (restricted scope)

`gmail.readonly` is a Google **restricted** scope. Until the app is verified,
users see an "unverified app" warning and the app is capped at 100 users. In
Testing mode, refresh tokens expire after 7 days, so Gmail disconnects itself
weekly during testing.

All steps are in Google Cloud Console → **Google Auth Platform**, in the project
that owns the Gmail client IDs.

1. **Branding** (brand verification, a few business days)
   - App name, logo, support email, home page, privacy policy (`/privacy`).
   - Add the domain under **Authorized domains** and verify it in Google
     Search Console. The home page must link to the privacy policy.
   - The privacy policy (`convex/legalPages.ts`) already has the Gmail section
     and the Limited Use statement. Keep both in sync with what the code does.
2. **Data Access**
   - Justify `gmail.readonly`: read-only access to find booking and receipt
     emails for the user's trip, processed only on the device, never sent to
     servers. `gmail.metadata` isn't enough because the parser needs the body.
   - Demo video (unlisted YouTube): the OAuth flow with the client ID visible in
     the browser URL, the consent screen, and where the imported data appears.
3. **Security assessment (CASA Tier 2)**
   - Normally required every year for restricted scopes, done by an authorized
     lab. Apps whose restricted data never leaves the device have been exempted.
     State this in the submission; the reviewer makes the final call.
4. **Audience** → set publishing status to **In production**, then submit.

Keep it compliant:

- Email content must never reach Convex, Sentry, analytics or logs that leave
  the device. Production builds strip `console.log/info/debug`, but not
  `console.warn` / `console.error`.
- If a code change sends email data off the device, the privacy policy, the Play
  Data safety form and the CASA exemption all need revisiting.
- Verification is reviewed again each year.
