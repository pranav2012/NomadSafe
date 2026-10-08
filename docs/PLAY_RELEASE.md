# Google Play release runbook

Status of each step for the first Android release. ✅ = done, 🧑 = you do it (needs a web console, payment or identity).

| # | Step | Status |
|---|---|---|
| 1 | Convex production deploy + env vars | 🧑 Redeploy: production predates safety alerts, billing and online AI (`npx convex deploy`) |
| 2 | Privacy policy and delete-account pages live | ✅ (updated text goes live with step 1) |
| 3 | EAS project linked, env vars set, upload keystore generated | ✅ |
| 4 | Production AAB built | 🧑 Rebuild after step 1: `eas build -p android --profile production` |
| 5 | App icon, adaptive icon, splash, 512 px icon, feature graphic | ✅ `assets/store/` |
| 6 | Google Cloud: sign-in redirect, Android OAuth clients, key restrictions | 🧑 |
| 7 | Play Console account + app + first upload | 🧑 |
| 8 | Play Console forms (content rating, data safety, permissions) | 🧑 |
| 9 | Closed testing (new personal accounts: 12 testers × 14 days) | 🧑 |
| 10 | Gmail restricted-scope verification (CASA) | 🧑 (can run in parallel) |
| 11 | PostHog error tracking and logs | 🧑 |
| 12 | AdMob app, real app/ad unit IDs, app-ads.txt, consent message | 🧑 Before the production build (step 4) |
| 13 | Firebase App Check (Play Integrity) for billed backend calls | 🧑 Before enforcing it on the server |
| 14 | EAS Update code signing key backed up | 🧑 Before the first `eas update` |

## Reference values

| What | Value |
|---|---|
| Package name | `com.pranav.nomadsafe` (permanent once uploaded) |
| Backend (prod) | `https://gregarious-crocodile-599.convex.cloud` |
| Site (prod) | `https://gregarious-crocodile-599.convex.site` |
| Public pages | `https://nomadsafe.pranav-agarwal.com` (the `website/` Worker: marketing page, and forwards these pages to the Convex site) |
| Privacy policy URL | `https://nomadsafe.pranav-agarwal.com/privacy` |
| Account deletion URL | `https://nomadsafe.pranav-agarwal.com/delete-account` |
| Google sign-in callback | `https://gregarious-crocodile-599.convex.site/api/auth/callback/google` |
| Support email | `p2012agarwal@gmail.com` (Convex `SUPPORT_EMAIL`) |
| Upload key SHA-1 | Printed by `keytool -printcert -jarfile <build>.aab`, or at expo.dev → Project → Credentials → Android |
| Store assets | `assets/store/play-icon-512.png`, `assets/store/feature-graphic-1024x500.png` |

---

## 6. Google Cloud Console 🧑

Open <https://console.cloud.google.com/apis/credentials> in the project that owns your current OAuth clients.

### 6a. Google sign-in (Better Auth, *Web* client)
1. Open the **Web application** OAuth client. Its ID is the `GOOGLE_CLIENT_ID` on Convex, starting `1749…`.
2. Under **Authorized redirect URIs**, add `https://gregarious-crocodile-599.convex.site/api/auth/callback/google`.
3. Save. Sign-in in production builds fails with `redirect_uri_mismatch` until you do this.

### 6b. Gmail import (*Android* clients)
Google ties an Android OAuth client to **one package + one SHA-1**, and the package name changed. Create these:

| Client | Package | SHA-1 from | Put its client ID in |
|---|---|---|---|
| NomadSafe Android (Play) | `com.pranav.nomadsafe` | Play Console → Test and release → App integrity → **App signing key** (available after step 7) | EAS env `EXPO_PUBLIC_GMAIL_ANDROID_CLIENT_ID`, **production** |
| NomadSafe Android (upload/preview) | `com.pranav.nomadsafe` | **Upload key** SHA-1 (see Reference values) | EAS env `EXPO_PUBLIC_GMAIL_ANDROID_CLIENT_ID`, **preview** |
| NomadSafe Android (debug) | `com.pranav.nomadsafe` | `keytool -list -v -keystore android/app/debug.keystore -storepass android` | `.env.local` for dev builds |

Create each one with **Create credentials → OAuth client ID → Android**. Then update EAS:

```bash
npx eas-cli env:update --environment production --variable-name EXPO_PUBLIC_GMAIL_ANDROID_CLIENT_ID --value <id>
```

Then rebuild. Gmail values are baked in at build time.

### 6c. OAuth consent screen
**APIs & Services → OAuth consent screen**:
- App name: NomadSafe
- Support email: `p2012agarwal@gmail.com`
- Logo: `assets/store/play-icon-512.png`
- Privacy policy: the URL above
- Authorized domain: `convex.site`

Add yourself and your testers as **test users**. Until verification (step 10) only test users can connect Gmail, up to 100 people.

### 6d. Restrict API keys
- **Maps SDK key** (EAS `GOOGLE_MAPS_ANDROID_API_KEY`): *Application restrictions → Android apps* → add `com.pranav.nomadsafe` with the upload SHA-1 and the app-signing SHA-1. *API restrictions → Maps SDK for Android*.
- **Places key** (Convex `GOOGLE_PLACES_API_KEY`): it runs on the server, so no app restriction is possible. Set *API restrictions → Places API (New)* only.

## 7. Play Console 🧑

1. Create a developer account at <https://play.google.com/console/signup>. It costs a **one-time US$25** and needs identity verification. This is the only paid step.
2. **Create app**: name NomadSafe, default language English, App (not game), Free.
3. **Test and release → Testing → Internal testing → Create new release.**
   - Accept **Play App Signing**, the default.
   - Upload the AAB. Download it from the EAS build page (expo.dev → Project → Builds → Download).
   - Release notes: "First internal build."
4. Open **App integrity** and copy the **App signing key SHA-1**, then finish 6b and 6d with it.
5. Add yourself as an internal tester, install from the opt-in link, and run the device checklist below.

Later builds can be uploaded from the CLI. Create a Google Cloud service account with the *Service Account User* role, invite it in Play Console → Users and permissions (Release manager), save the JSON key as `play-service-account.json` (gitignored), then run:

```bash
npx eas-cli submit -p android --profile production --path <aab or latest>
```

## 8. Play Console forms 🧑 (Policy → App content)

| Form | Answer |
|---|---|
| Privacy policy | `https://nomadsafe.pranav-agarwal.com/privacy` |
| App access | Restricted. Add a Google test account (email + password) for reviewers. Note: "Sign in with Google." (The app lock is off by default.) |
| Ads | **Yes, the app contains ads** (Free plan only; AdMob interstitials after finished actions) |
| Content rating | Complete the IARC questionnaire. It's a utility app with no user-generated public content; location sharing is only with contacts the user chose. Expect Everyone / PEGI 3. |
| Target audience | 18 and over (or 13+). Not designed for children. |
| News app | No |
| Data safety | See the table below |
| Government app | No |
| Financial features | None (expense tracking only, no payments). In-app subscriptions go through Google Play Billing. |
| Health | None |
| Account deletion | In-app: Settings → Delete account. Web: the account deletion URL. |

### Data safety answers
- Saved links: previews (YouTube/TikTok oEmbed, page titles) and in-app playback load straight from those sites at the user's request. Like opening a link in a browser, this isn't collected or shared by NomadSafe, so it isn't a data type in the form, but the privacy policy lists it under "Services that receive limited data".
- Collects or shares data: **Yes**. Encrypted in transit: **Yes**. Users can request deletion: **Yes**.

| Data type | Collected | Shared | Processed ephemerally | Required? | Purposes |
|---|---|---|---|---|---|
| Location → Precise | Yes (live sharing, SOS, and the place saved with an expense in the trip backup) | Yes (with contacts the user picks) | No | Optional | App functionality |
| Location → Approximate | Yes | No (Google Places is a service provider, via our server) | Yes | Optional | App functionality |
| Personal info → Name, Email, User IDs | Yes | No | No | Required | Account management |
| Contacts | Yes (name + email of people invited to sharing) | No | No | Optional | App functionality |
| Messages → Emails | No (email text is read on the device and never uploaded; expenses and bookings created from emails are covered by the trip backup rows) | No | n/a | n/a | n/a |
| Financial info → Other financial info (trip budgets, expenses, splits and settlements in the trip backup and shared trips) | Yes | No (shown to a shared trip's members only when the user adds them there) | No | Optional (Settings → Back up to my account) | App functionality |
| App activity → Other user-generated content (trips, planned trips, destinations, itinerary, saved ideas with their links and notes, companion names) | Yes | No (same as above) | No | Optional (Settings → Back up to my account) | App functionality |
| Device or other IDs (push notification token) | Yes | No | No | Optional (notifications) | App functionality |
| App info and performance → Crash logs, Diagnostics | Yes, if PostHog is enabled | No | No | Optional (Settings → Share usage analytics) | Analytics |
| App activity → App interactions, Other user-generated content (masked session recordings) | Yes, if PostHog is enabled | No | No | Optional (Settings → Share usage analytics) | Analytics |
| Location → Approximate (country/city from IP, via PostHog GeoIP) | Yes, if PostHog is enabled | No | No | Optional | Analytics |
| Device or other IDs (PostHog anonymous ID) | Yes, if PostHog is enabled | No | No | Optional | Analytics |
| Messages → Other in-app messages (AI chat questions, voice-expense text) | Yes, when online AI is used | Yes (OpenRouter and its model provider, via our server, for Pro; the user's own provider for their key) | Yes | Optional (Settings → Online AI) | App functionality |
| Financial info → Other financial info (trip budget and spending figures sent with AI requests) | Yes, when online AI is used | Yes (as above) | Yes | Optional (Settings → Online AI) | App functionality |
| App activity → App interactions (monthly NomadSafe Cloud request counts per AI feature; no content) | Yes, with Pro | No | No | Optional (Settings → Online AI) | App functionality |
| Financial info → Purchase history | Yes | Yes (RevenueCat) | No | Optional (only with a paid plan) | App functionality, Account management |
| Device or other IDs (advertising ID) | Yes (Free plan, by the Google Mobile Ads SDK) | Yes (Google AdMob) | No | Required on the Free plan (not collected on paid plans) | Advertising or marketing |
| App activity → App interactions (ad views and taps) | Yes (Free plan) | Yes (Google AdMob) | No | Required on the Free plan | Advertising or marketing, Analytics |
| Location → Approximate (IP-derived, by the ads SDK) | Yes (Free plan) | Yes (Google AdMob) | No | Required on the Free plan | Advertising or marketing |
| App info and performance → Diagnostics (ads SDK) | Yes (Free plan) | Yes (Google AdMob) | No | Required on the Free plan | Advertising or marketing, Analytics |

Also in **App content → Advertising ID**: answer **Yes**, the app uses an advertising ID, for **Advertising or marketing** (and Analytics). The Google Mobile Ads SDK adds `com.google.android.gms.permission.AD_ID` to the manifest; keep it out of `android.blockedPermissions`, or Play rejects the declaration and ads lose the ID.

### Sensitive permissions (Policy → App content → Sensitive permissions)
- **Location permissions → background location**
  - Feature: "Live location sharing: the user explicitly starts sharing their live location with trusted contacts they have added and who accepted. Sharing keeps working when the phone is locked, so contacts can find a traveller in an emergency. A persistent notification is shown while active, and the user can stop at any time."
  - Video (30–60 s, unlisted YouTube link): open Share tab → Start live sharing → the disclosure screen → Allow all the time → the notification → a second phone showing the location.
- **Foreground service type: location**: same description and video.
- If Play flags SMS / Call Log permissions, the manifest has regressed. They're blocked in `app.json`.

## 9. Closed testing 🧑 (personal accounts only)

Personal developer accounts created after Nov 2023 must run a **closed test with at least 12 testers opted in for 14 consecutive days** before they can apply for production access. Organisation accounts (which need a D-U-N-S number) skip this.

1. Testing → Closed testing → Create track → upload the same AAB → add testers by email list or Google Group.
2. Share the opt-in link. Testers must accept and install.
3. After 14 days: Dashboard → **Apply for production** and answer the questions about your test.

## 10. Gmail verification 🧑 (optional for launch)

`gmail.readonly` is a restricted scope. Until it's verified, only the test users from 6c can connect Gmail. Everything else works for everyone.

1. OAuth consent screen → **Publish app** → **Prepare for verification**.
2. Give a scope justification ("reads booking confirmations and receipts to import trip expenses and itinerary. Emails are read on the device and their text is never uploaded; the expenses and bookings created from them are saved in the user's trip backup") and a demo video of the Gmail import.
3. Google assigns a **CASA Tier 2** security assessment through an approved lab. It usually takes 2–6 weeks, and some labs charge a fee.

If you want to launch before that finishes, ship with Gmail limited to test users and turn it on for everyone after verification. No new build is needed.

## 11. PostHog error tracking and logs 🧑

Crash reports (JS, Android JVM + NDK, iOS) and logs go through the same PostHog client as analytics, so they follow the analytics opt-out.

1. In PostHog → Settings → Error tracking, turn on **Exception autocapture** (the SDK only captures when this is on).
2. Create a personal API key with the **error tracking write** scope.
3. Add EAS env vars for **preview and production**: `POSTHOG_CLI_API_KEY` (**secret**), `POSTHOG_CLI_PROJECT_ID` and `POSTHOG_CLI_HOST=https://eu.posthog.com` (plaintext). Release builds upload Hermes source maps, R8 mappings, `.so` symbols and dSYMs, and fail without them.
4. OTA updates: `pnpm update:<channel>` uploads the update's Hermes maps too, when the `POSTHOG_CLI_*` vars are set in your shell.

## Store listing (Grow → Store presence → Main store listing)

- **App name:** NomadSafe
- **Short description (80 chars):** Travel safety: SOS, live location sharing, trip budgets and an AI travel guide.
- **Full description:** draft below.
- **App icon:** `assets/store/play-icon-512.png`
- **Feature graphic:** `assets/store/feature-graphic-1024x500.png`
- **Phone screenshots:** 2–8 PNGs, 1080×1920 or larger. Take them on the internal-test build: Home, Safety/SOS, Sharing, Money, AI chat.
- **Category:** Travel & Local. **Contact email:** `p2012agarwal@gmail.com`. **Privacy policy:** the URL above.

Draft full description:

> NomadSafe keeps solo and group travellers safe and organised.
>
> • SOS in one hold: a 5-second cancel window, then an SMS to your emergency contacts with your location, plus one-tap calling to the local emergency number.
> • Check-ins: set a timer before a hike or a late ride. If you don't check in, contacts who use NomadSafe are alerted automatically.
> • Live location sharing, only with people you choose and who accept. Pause anyone, stop anytime.
> • Trips and itinerary: destinations, weather, nearby places, and booking details imported from Gmail (optional).
> • Money: a trip budget in your home currency. Paste a bank alert or import receipts; amounts are converted automatically.
> • An AI travel guide that runs on your phone, even offline. Optionally use a more capable online AI with Pro or your own API key.
>
> Your trips, expenses and chats are stored encrypted on your phone. Your trips are backed up to your account (you can turn this off), and your live location goes to our servers only while you share it. Delete your account at any time in Settings.

## 12. AdMob 🧑

1. Create an AdMob account and add the Android app (and iOS later), linked to the Play listing once it's published.
2. ✅ App IDs are set in `app.json` (`react-native-google-mobile-ads` plugin): Android `ca-app-pub-6692019921438774~3292587091`, iOS `ca-app-pub-6692019921438774~8391947090`. They're static on purpose (env-dependent app config breaks the EAS fingerprint).
3. Create one **Interstitial** ad unit per platform and set `EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID` / `EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_ID` in the EAS **production** (and preview, if you want real ads there) environment. Without them, and in dev builds, the app uses Google's test ad unit.
4. **Privacy & messaging**: create a GDPR (European regulations) message for the app, and a US state regulations message if you want it. The app shows it through UMP (`AdsConsent.gatherConsent`) before starting the SDK. Add the privacy policy URL there.
5. **app-ads.txt**: AdMob → Apps → app-ads.txt gives a line like `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`. Host it at `https://<developer website>/app-ads.txt`, where the developer website is the one in the Play store listing (Play Console → Store settings → Website).
6. Test on a real phone with the test ad unit (or a registered test device) only; clicking your own live ads can get the AdMob account suspended.

## 13. Firebase App Check 🧑

The app sends an App Check token with billed backend calls (Places, cloud AI, weather refresh, plan refresh) as the `appCheckToken` argument, and as the `X-Firebase-AppCheck` header on the streamed `/ai/chat` request. `@/modules/appCheck` uses Play Integrity on Android release builds and the debug provider in development builds. Without a token the request still goes out; the server decides whether to accept it.

1. Firebase console → the project that owns `google-services.json` → **App Check** → Apps → the Android app → **Play Integrity**. Add the **app signing key** SHA-256 (Play Console → Test and release → App integrity → App signing) and, for internal builds installed outside Play, the EAS upload key SHA-256 (expo.dev → Credentials → Android).
2. Play Console → App integrity → **Play Integrity API**: link the same Google Cloud project.
3. Development builds: set `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN` to a UUID in `.env.local` (and the EAS `development` environment), then add that token under App Check → Apps → ⋮ → **Manage debug tokens**. Without it, the native debug provider logs a generated token to logcat (`DebugAppCheckProvider`) that you can register instead. Never put debug tokens in preview or production environments.
4. Watch App Check → **Metrics** for a few days of real traffic (verified vs. unverified requests) before the server starts rejecting requests without a valid token.

**iOS (later):** App Check is skipped on iOS until Firebase is configured there. To turn it on: add `GoogleService-Info.plist` and set `ios.googleServicesFile` in `app.json` (`plugins/withFirebaseAppCheck.js` then applies the React Native Firebase plugins), remove the iOS exclusions from `react-native.config.js`, and make the Firebase pods build: either `expo-build-properties` → `ios.useFrameworks: "dynamic"` (needed for Firebase via Swift Package Manager, the default) or the RN Firebase `ios.disableSPM` option with `useFrameworks: "static"`. Check both against llama.rn, Skia and Nitro before shipping. Register the app for **App Attest** (DeviceCheck fallback) in App Check, and add the App Attest entitlement.

## 14. EAS Update code signing 🧑

Updates are signed, and builds reject unsigned or wrongly signed updates (`updates.codeSigningCertificate` in `app.json`). The certificate (`certs/certificate.pem`, valid 10 years) is public and committed; the private key (`keys/private-key.pem`) is gitignored.

1. Back up `keys/private-key.pem` somewhere safe (a password manager or an encrypted vault), not in the repo. Without it, no update can reach builds that carry this certificate; a new key means a new store build.
2. Publish with `pnpm update:<channel>`, which passes `--private-key-path keys/private-key.pem`. Calling `eas update` directly needs the same flag.
3. A new machine needs the key copied into `keys/` before it can publish.

The certificate changes the runtime fingerprint, so builds made before it can't take signed updates; ship a store build first.

---

## Device test checklist (internal-test build, real Android phone)

- [ ] Fresh install → Google sign-in → onboarding → tabs (no lock).
- [ ] Kill and reopen → lock screen. Back button and a deep link (`nomadsafe:///settings`) don't bypass it.
- [ ] 5 wrong PINs → lockout survives an app restart, and moving the phone's clock forward doesn't end it.
- [ ] Settings → App lock: turning it on or off shows the phone's unlock prompt; with it on, the app locks after the auto-lock time and unlocks with biometrics or the phone's passcode.
- [ ] The recents screen shows a blank card for NomadSafe (Android 13+); screenshots inside the app still work.
- [ ] Live sharing: disclosure → "Allow all the time" → notification → a second account sees updates with the screen off.
- [ ] Pause one contact → their updates stop. Stop sharing → both sides show "not sharing".
- [ ] SOS: releasing early does nothing. The full hold → 5 s countdown → SMS composer with a map link. Cancel works.
- [ ] Check-in: the reminder fires with the app killed, and the missed state appears on reopen.
- [ ] AI model: download on Wi-Fi, pause, kill the app → it doesn't auto-resume. Resume → completes. Chat, then stop mid-reply.
- [ ] Expenses: paste `EUR 1.234,56` and an OTP message → correct amount, OTP ignored. Gmail import with a test user.
- [ ] Settings → Export (share sheet), Wipe, Delete account (rows gone in the Convex dashboard).
- [ ] Ads (Free plan): set the `ad_frequency` flag payload to `{"graceHours":0,"graceSessions":0,"sessionDelaySeconds":0}` for the test account. The first trip shows no ad; the next new trip shows a test interstitial after the planner closes; another action within 3 minutes shows none; every 4th hand-entered expense and a Gmail/paste import show one; nothing ever appears on SOS, voice capture or the lock screen. With a VPN in the EU, the consent form appears once after unlock, and Settings shows **Ad privacy choices**. After buying Plus, no more ads and the row is gone.
- [ ] Switch to Arabic → the app reloads right-to-left, and chevrons are mirrored.
- [ ] Airplane mode on each tab → no crashes, readable errors.
