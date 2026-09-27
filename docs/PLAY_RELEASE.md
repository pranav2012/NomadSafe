# Google Play release runbook

Steps that live outside the codebase. Work top to bottom for the first release.

## 1. Backend (Convex production)

```bash
npx convex deploy                      # creates/updates the prod deployment
npx convex env set SITE_URL https://<prod>.convex.site --prod
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" --prod
npx convex env set GOOGLE_CLIENT_ID <web-oauth-client-id> --prod
npx convex env set GOOGLE_CLIENT_SECRET <web-oauth-client-secret> --prod
npx convex env set GOOGLE_PLACES_API_KEY <server-key> --prod
npx convex env set SUPPORT_EMAIL <your-support-email> --prod
```

Check that these pages load. You'll paste both URLs into Play Console:

- `https://<prod>.convex.site/privacy`: the privacy policy
- `https://<prod>.convex.site/delete-account`: the account-deletion page

Web deletion requests are stored in the `deletionRequests` table. After confirming a request by email, run `account:processDeletionRequest` with `{ "email": "..." }` from the Convex dashboard.

## 2. EAS project and environment variables

```bash
npm i -g eas-cli && eas login
eas init                                # links the project, writes extra.eas.projectId
```

Set these under **expo.dev → Project → Environment variables** for the `production` environment (and `preview`):

| Variable | Visibility |
|---|---|
| `EXPO_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_CONVEX_SITE_URL` | Plain text |
| `EXPO_PUBLIC_GMAIL_WEB_CLIENT_ID`, `EXPO_PUBLIC_GMAIL_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GMAIL_IOS_CLIENT_ID` | Plain text |
| `EXPO_PUBLIC_SENTRY_DSN` | Plain text |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Sensitive |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Plain text |
| `SENTRY_AUTH_TOKEN` | Secret |

The app throws on launch if the Convex URLs are missing, and prebuild fails without the Maps key.

## 3. Signing and Google Cloud

1. Run `eas credentials -p android` and let EAS generate the upload keystore.
2. In Play Console, create the app with package **`com.pranav.nomadsafe`** (permanent) and enrol in **Play App Signing**.
3. Copy **both** SHA-1 fingerprints: the upload key (from EAS) and the app signing key (Play Console → App integrity).
4. In Google Cloud Console:
   - **Android OAuth client** (used by Gmail import): package `com.pranav.nomadsafe`, plus each SHA-1. Create one client per SHA-1 if needed.
   - **Maps SDK key**: restrict it to Android apps, `com.pranav.nomadsafe` + both SHA-1s, and the Maps SDK for Android API only.
   - **Places key** (server): restrict it to the Places API (New). It's used only by Convex.
   - **Google sign-in (Better Auth)** uses the *web* client. Add `https://<prod>.convex.site/api/auth/callback/google` as an authorized redirect URI.

## 4. Gmail restricted-scope verification

`gmail.readonly` is a **restricted** scope. Until Google verifies it, only the 100 test users on the OAuth consent screen can connect Gmail. Everyone else sees an "unverified app" block.

1. On the OAuth consent screen, fill in app name, logo, support email, the privacy policy URL (`/privacy`) and the authorized domain (`convex.site` or your own domain).
2. Submit for verification with a demo video of the Gmail import flow and a justification for the scope.
3. Complete the **CASA** security assessment (Tier 2) that Google assigns. This takes a few weeks and may cost money depending on the assessor.

A custom domain for the policy pages makes verification smoother than `*.convex.site`.

## 5. Build and submit

```bash
eas build -p android --profile production     # AAB, versionCode auto-increments
eas submit -p android --profile production    # uploads to the internal track as a draft
```

Test the internal-track build on real devices before promoting it. See the device checklist below.

## 6. Play Console forms

### App content
- **Privacy policy**: `https://<prod>.convex.site/privacy`
- **App access**: sign-in is required. Give reviewers a Google test account, plus a note that no PIN is needed until they create one.
- **Ads**: none.
- **Target audience**: 18+ (or 13+). Not for children.
- **Data deletion**: in-app (Settings → Delete account) and the web URL `/delete-account`.

### Permissions declarations
- **Location permissions (background)**
  - Core feature: "Live location sharing with trusted contacts chosen by the user, which keeps working while the app is closed, for traveller safety."
  - Record a short video: start sharing in the app → disclosure screen → "Allow all the time" → the persistent notification → a contact seeing the location.
- **Foreground service: location**: same feature and video. The service only runs while the user has live sharing turned on.
- The app **does not** request SMS or Call Log permissions (they're blocked in `app.json`). If Play still flags them, the merged manifest has regressed: check `android.blockedPermissions`.

### Data safety (answer from the privacy policy)
| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Name, email address | Yes | No | Account management | No (sign-in) |
| User IDs | Yes | No | Account management | No |
| Precise location | Yes | Yes, with contacts the user chose | App functionality | Yes (live sharing) |
| Approximate location | Yes | Yes, with Google Places via our server | App functionality | Yes (nearby places) |
| Contacts (name, email of invitees) | Yes | No | App functionality | Yes |
| Emails (Gmail) | **Not collected** (processed on device only) | No | n/a | n/a |
| Crash logs, diagnostics | Yes (Sentry) | No | Analytics | No |

- Encrypted in transit: **Yes**.
- Users can request deletion: **Yes**.

## 7. Store listing assets (still to do)

The icon, adaptive icon and splash in `assets/images/` are still the Expo template images. Replace them before submitting:

- `icon.png`: 1024×1024
- `android-icon-foreground.png`, `android-icon-background.png`, `android-icon-monochrome.png`: adaptive icon layers
- `splash-icon.png`
- Play listing: 512×512 icon, 1024×500 feature graphic, at least 2 phone screenshots

## Device test checklist (release build, real Android device)

- [ ] Fresh install → onboarding → Google sign-in → PIN → tabs.
- [ ] Kill the app and reopen → lock screen. Back button and deep link (`nomadsafe:///settings`) don't bypass it.
- [ ] 5 wrong PINs → lockout survives an app restart.
- [ ] Live sharing: disclosure → "Allow all the time" → notification visible → a second account sees the location update with the screen off.
- [ ] Pause one contact → their location stops updating. Stop → both sides show "not sharing".
- [ ] SOS: releasing early does nothing. The full hold → 5 s countdown → SMS composer with a map link. Cancel works.
- [ ] Check-in: the reminder notification fires with the app killed. The missed state appears on reopen.
- [ ] AI model: download on Wi-Fi, pause, kill the app → it doesn't resume by itself. Resume → completes. Chat, then stop mid-reply.
- [ ] Expenses: paste a bank alert with `1.234,56` and with an OTP message → correct amount and OTP ignored. Gmail import with a test account.
- [ ] Settings → Export (share sheet opens), Wipe, and Delete account (server rows gone in the Convex dashboard).
- [ ] Switch the language to Arabic → the app reloads right-to-left, and back chevrons are mirrored.
- [ ] Airplane mode on each tab → no crashes, only readable errors.
