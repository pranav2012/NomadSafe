# Google Play release runbook

Status of each step for the first Android release. ✅ = done, 🧑 = you do it (needs a web console, payment or identity).

| # | Step | Status |
|---|---|---|
| 1 | Convex production deploy + env vars | ✅ |
| 2 | Privacy policy and delete-account pages live | ✅ |
| 3 | EAS project linked, env vars set, upload keystore generated | ✅ |
| 4 | Production AAB built | ✅ (see the build page on expo.dev) |
| 5 | App icon, adaptive icon, splash, 512 px icon, feature graphic | ✅ `assets/store/` |
| 6 | Google Cloud: sign-in redirect, Android OAuth clients, key restrictions | 🧑 |
| 7 | Play Console account + app + first upload | 🧑 |
| 8 | Play Console forms (content rating, data safety, permissions) | 🧑 |
| 9 | Closed testing (new personal accounts: 12 testers × 14 days) | 🧑 |
| 10 | Gmail restricted-scope verification (CASA) | 🧑 (can run in parallel) |
| 11 | Sentry (optional) | 🧑 |

## Reference values

| What | Value |
|---|---|
| Package name | `com.pranav.nomadsafe` (permanent once uploaded) |
| Backend (prod) | `https://gregarious-crocodile-599.convex.cloud` |
| Site (prod) | `https://gregarious-crocodile-599.convex.site` |
| Privacy policy URL | `https://gregarious-crocodile-599.convex.site/privacy` |
| Account deletion URL | `https://gregarious-crocodile-599.convex.site/delete-account` |
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
| Privacy policy | `https://gregarious-crocodile-599.convex.site/privacy` |
| App access | Restricted. Add a Google test account (email + password) for reviewers. Note: "Sign in with Google, create any 6-digit PIN." |
| Ads | No ads |
| Content rating | Complete the IARC questionnaire. It's a utility app with no user-generated public content; location sharing is only with contacts the user chose. Expect Everyone / PEGI 3. |
| Target audience | 18 and over (or 13+). Not designed for children. |
| News app | No |
| Data safety | See the table below |
| Government app | No |
| Financial features | None (expense tracking only, no payments) |
| Health | None |
| Account deletion | In-app: Settings → Delete account. Web: the account deletion URL. |

### Data safety answers
- Collects or shares data: **Yes**. Encrypted in transit: **Yes**. Users can request deletion: **Yes**.

| Data type | Collected | Shared | Processed ephemerally | Required? | Purposes |
|---|---|---|---|---|---|
| Location → Precise | Yes | Yes (with contacts the user picks) | No | Optional | App functionality |
| Location → Approximate | Yes | Yes (Google Places, via our server) | Yes | Optional | App functionality |
| Personal info → Name, Email, User IDs | Yes | No | No | Required | Account management |
| Contacts | Yes (name + email of people invited to sharing) | No | No | Optional | App functionality |
| App activity / Emails | No (Gmail is processed on-device only) | No | n/a | n/a | n/a |
| App info and performance → Crash logs, Diagnostics | Yes, only if Sentry is enabled | No | No | Required | Analytics |
| App activity → App interactions, Other user-generated content (masked session recordings) | Yes, if PostHog is enabled | No | No | Optional (Settings → Share usage analytics) | Analytics |
| Location → Approximate (country/city from IP, via PostHog GeoIP) | Yes, if PostHog is enabled | No | No | Optional | Analytics |
| Device or other IDs (PostHog anonymous ID) | Yes, if PostHog is enabled | No | No | Optional | Analytics |

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
2. Give a scope justification ("reads booking confirmations and receipts to import trip expenses and itinerary; processed on-device") and a demo video of the Gmail import.
3. Google assigns a **CASA Tier 2** security assessment through an approved lab. It usually takes 2–6 weeks, and some labs charge a fee.

If you want to launch before that finishes, ship with Gmail limited to test users and turn it on for everyone after verification. No new build is needed.

## 11. Sentry 🧑 (optional)

1. Create a React Native project at <https://sentry.io>.
2. Add EAS env vars (production): `EXPO_PUBLIC_SENTRY_DSN` (plaintext), `SENTRY_ORG`, `SENTRY_PROJECT` (plaintext), `SENTRY_AUTH_TOKEN` (**secret**).
3. Remove `SENTRY_DISABLE_AUTO_UPLOAD` from `build.base.env` in `eas.json` so source maps upload, then rebuild. Crash reporting stays off until the DSN is set.

## Store listing (Grow → Store presence → Main store listing)

- **App name:** NomadSafe
- **Short description (80 chars):** Travel safety: SOS, live location sharing, trip budgets and an on-device AI.
- **Full description:** draft below.
- **App icon:** `assets/store/play-icon-512.png`
- **Feature graphic:** `assets/store/feature-graphic-1024x500.png`
- **Phone screenshots:** 2–8 PNGs, 1080×1920 or larger. Take them on the internal-test build: Home, Safety/SOS, Sharing, Money, AI chat.
- **Category:** Travel & Local. **Contact email:** `p2012agarwal@gmail.com`. **Privacy policy:** the URL above.

Draft full description:

> NomadSafe keeps solo and group travellers safe and organised.
>
> • SOS in one hold: a 5-second cancel window, then an SMS to your emergency contacts with your location, plus one-tap calling to the local emergency number.
> • Check-ins: set a timer before a hike or a late ride. If you don't check in, you're reminded and can alert your contacts in one tap.
> • Live location sharing, only with people you choose and who accept. Pause anyone, stop anytime.
> • Trips and itinerary: destinations, weather, nearby places, and booking details imported from Gmail (optional).
> • Money: a trip budget in your home currency. Paste a bank alert or import receipts; amounts are converted automatically.
> • An AI travel guide that runs entirely on your phone: your chats never leave the device.
>
> Your trips, expenses and chats are stored encrypted on your phone. Only your account and, while you share, your live location go to our servers. Delete your account at any time in Settings.

---

## Device test checklist (internal-test build, real Android phone)

- [ ] Fresh install → onboarding → Google sign-in → PIN → tabs.
- [ ] Kill and reopen → lock screen. Back button and a deep link (`nomadsafe:///settings`) don't bypass it.
- [ ] 5 wrong PINs → lockout survives an app restart.
- [ ] Live sharing: disclosure → "Allow all the time" → notification → a second account sees updates with the screen off.
- [ ] Pause one contact → their updates stop. Stop sharing → both sides show "not sharing".
- [ ] SOS: releasing early does nothing. The full hold → 5 s countdown → SMS composer with a map link. Cancel works.
- [ ] Check-in: the reminder fires with the app killed, and the missed state appears on reopen.
- [ ] AI model: download on Wi-Fi, pause, kill the app → it doesn't auto-resume. Resume → completes. Chat, then stop mid-reply.
- [ ] Expenses: paste `EUR 1.234,56` and an OTP message → correct amount, OTP ignored. Gmail import with a test user.
- [ ] Settings → Export (share sheet), Wipe, Delete account (rows gone in the Convex dashboard).
- [ ] Switch to Arabic → the app reloads right-to-left, and chevrons are mirrored.
- [ ] Airplane mode on each tab → no crashes, readable errors.
