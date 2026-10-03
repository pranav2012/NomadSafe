import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const EFFECTIVE_DATE = "4 October 2026";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#072B40"/><path d="M80 300 C140 200 200 200 256 260 C320 330 360 320 400 260" fill="none" stroke="#22D3EE" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="3 12" opacity="0.75"/><g transform="translate(400,260) rotate(-50)"><path d="M-14 -10 L14 0 L-14 10 L-6 0 Z" fill="#E6F6FF"/></g><path d="M196 184 L316 360" stroke="#E6F6FF" stroke-width="40" stroke-linecap="round" opacity="0.32"/><rect x="176" y="168" width="44" height="176" rx="22" fill="#E6F6FF"/><rect x="292" y="168" width="44" height="176" rx="22" fill="#E6F6FF"/><path d="M200 168 L320 344" stroke="#E6F6FF" stroke-width="40" stroke-linecap="round"/></svg>`;
const FAVICON = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contactLine() {
  const email = process.env.SUPPORT_EMAIL;
  return email
    ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
    : "the developer contact email listed on our Google Play page";
}

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · NomadSafe</title>
<link rel="icon" href="${FAVICON}">
<style>
body{font:16px/1.6 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:32px 20px;color:#1d2327;background:#faf7f2}
h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 8px}
.muted{color:#5f6b72;font-size:14px}ul{padding-left:20px}li{margin:4px 0}
form{display:grid;gap:12px;margin-top:16px;max-width:420px}
input,textarea,button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #cfc8bc}
button{background:#1d4d4f;color:#fff;border:0;cursor:pointer}
.card{background:#fff;border:1px solid #e6dfd3;border-radius:14px;padding:16px 18px;margin-top:16px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px;font-weight:600;font-size:18px;color:#072B40}
.brand svg{width:40px;height:40px}
</style></head><body><div class="brand">${LOGO_SVG}<span>NomadSafe</span></div>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

export const privacyPolicy = httpAction(async () => {
  return page(
    "Privacy Policy",
    `<h1>NomadSafe Privacy Policy</h1>
<p class="muted">Effective ${EFFECTIVE_DATE}</p>
<p>NomadSafe is a travel safety and planning app. This policy explains what data the app collects, why, where it goes, and how you can delete it. The sections below list exactly what stays on your device and what is stored on our servers.</p>

<h2>Data stored only on your device</h2>
<ul>
<li>The original text of messages you paste or import from Gmail to find expenses and bookings.</li>
<li>Emergency contacts you pick, SMS templates and safety check-in history.</li>
<li>AI chat history. The AI model runs entirely on your device; prompts and replies are never sent to us.</li>
<li>Your app PIN (stored in the Android Keystore / iOS Keychain).</li>
</ul>
<p>This data is kept in encrypted app storage and is excluded from cloud backups. Trips, expenses and itinerary are kept in the same encrypted storage on your device as well as in your account backup (below). If you add the NomadSafe home-screen widget, your trip names are also kept in the widget's own storage on your device so it can show them. Uninstalling the app or using <em>Settings → Wipe device data</em> removes it.</p>

<h2>Data stored on our servers</h2>
<ul>
<li><strong>Account:</strong> when you sign in with Google we receive your name, email address and profile photo to create your account.</li>
<li><strong>Live location sharing (optional):</strong> while you have sharing turned on, your precise location, battery level and sharing mode are sent to our server and shown only to contacts who accepted your request. This includes when the app is closed or not in use, which Android indicates with a persistent notification. We keep only your latest position per contact, not a location history. Turning sharing off marks it inactive immediately.</li>
<li><strong>Sharing contacts:</strong> the name and email address of people you invite to receive your location, and the status of those requests.</li>
<li><strong>Trip backup (on by default, can be turned off):</strong> your trips (names, destinations, dates, budget, companions), itinerary events, expenses (merchant, amount, category, notes, splits and the place you added) and settlements are saved to your account so they come back when you sign in on another phone. The original text of imported messages is never uploaded. Turning off <em>Settings → Back up to my account</em> deletes this copy from our servers; signing out removes it from your phone.</li>
<li><strong>Shared trips (optional):</strong> when you create an invite link for a trip or join one, the trip details, itinerary, the expenses split with others (including where they were added), payments between members, and each member's display name are stored on our servers and shown to everyone on that trip. Anyone with the link or code can join. Expenses you don't split stay private to you. When you leave, your past shared expenses stay on the trip under your name.</li>
<li><strong>Notifications for shared trips:</strong> a push token for your device and your app language. When someone changes a shared expense, the notification text (trip name, their name, the expense name and amount) goes through Expo's push service and Google Firebase Cloud Messaging or Apple Push Notification service to reach your phone. You can mute notifications per trip.</li>
</ul>
<p>Our backend is hosted by Convex (convex.dev). Data is encrypted in transit (HTTPS).</p>

<h2>Gmail import (optional)</h2>
<p>If you connect Gmail, NomadSafe requests read-only access to find booking confirmations and receipts for your trips. Emails are fetched and processed on your device only; their contents are not sent to our servers or any third party, not used for advertising, and not read by humans. Access tokens are stored securely on your device, and you can disconnect at any time from the app or at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
<p>NomadSafe's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

<h2>SOS and emergency messages</h2>
<p>When you trigger SOS or a missed check-in alert, NomadSafe opens your phone's SMS app with a pre-filled message (including your location) addressed to your emergency contacts. The message is sent by your phone's SMS app, not by us, and only after you confirm it.</p>

<h2>Services that receive limited data</h2>
<ul>
<li><strong>Google Places</strong> (via our server): your approximate coordinates, to suggest nearby places and emergency services, and the names of places from your itinerary (such as your hotel), to show them on the map.</li>
<li><strong>Google Maps</strong>: map tiles for locations shown in the app.</li>
<li><strong>OpenStreetMap Nominatim</strong>: destination search text and coordinates, for geocoding.</li>
<li><strong>Open-Meteo</strong>: trip coordinates, for weather forecasts and current conditions, and a fixed worldwide grid of points, for the globe's live cloud cover.</li>
<li><strong>NASA GIBS</strong>: a rough rectangle around your trip's destinations, to download satellite imagery for the home globe.</li>
<li><strong>Frankfurter</strong>: currency pairs and dates, for exchange rates.</li>
<li><strong>Hugging Face</strong>: model download requests (your IP address), if you download an AI model.</li>
<li><strong>PostHog</strong> (EU hosting): usage analytics, feature flags, session recordings, crash reports and diagnostic logs, described below.</li>
</ul>

<h2>Usage analytics</h2>
<p>To see which features work and which don't, and to test changes, NomadSafe sends usage analytics to PostHog, hosted in the EU. They are linked to your account ID once you sign in. They include:</p>
<ul>
<li>Which screens you open and actions you take, such as creating a trip, adding an expense, starting live sharing or triggering SOS, with counts and types only (for example "3 expenses imported from Gmail").</li>
<li>Device model, OS, app version, language and an approximate country and city derived from your IP address. Your precise location is never sent.</li>
<li>Session recordings: screenshots of the app with all text, input fields, images and maps masked. Recording pauses while the lock screen or PIN setup is showing.</li>
<li>Crash reports and diagnostic logs: device model, OS, app version, technical details of the error, and counts (for example "12 emails scanned, 3 expenses found").</li>
</ul>
<p>Analytics never include your trip names or destinations, expense amounts or merchants, notes, chats, emails, contacts or location. You can turn analytics, crash reports and logs off at any time in <em>Settings → Share usage analytics</em>. Analytics and crash reports are kept for up to 12 months, diagnostic logs for 14 days and session recordings for up to 30 days.</p>
<p>We do not sell your data, use it for advertising, or share it with data brokers.</p>

<h2>Permissions</h2>
<ul>
<li><strong>Location, including background:</strong> live location sharing, SOS location and nearby places. Background location is used only while you have live sharing turned on.</li>
<li><strong>Contacts:</strong> only to let you pick emergency contacts. We read the contact you pick; your address book is not uploaded.</li>
<li><strong>Microphone and speech recognition:</strong> only when you tap Speak to add an expense by voice. Your phone's on-device speech recognizer turns speech into text, and the on-device AI reads the text; audio is not recorded, and neither audio nor text is sent to us or anyone else.</li>
<li><strong>Notifications:</strong> check-in reminders, sharing status and download progress.</li>
<li><strong>Biometrics:</strong> to unlock the app. Biometric data never leaves your device's secure hardware.</li>
</ul>

<h2>Retention and deletion</h2>
<p>You can delete your account at any time in <em>Settings → Delete account</em>. This immediately deletes your account, sessions, sharing links, location shares and invites from our servers. Your usage analytics, crash reports and session recordings are deleted from PostHog within a few days, and diagnostic logs expire within 14 days. You can also <a href="/delete-account">request deletion on the web</a>. Otherwise, usage analytics and crash reports are retained by PostHog for up to 12 months and session recordings for up to 30 days.</p>

<h2>Children</h2>
<p>NomadSafe is not directed to children under 13 (or the minimum age in your country) and we do not knowingly collect their data.</p>

<h2>Changes and contact</h2>
<p>We will update this page when our practices change and revise the effective date. Questions or requests: ${contactLine()}.</p>`,
  );
});

export const deleteAccountPage = httpAction(async () => {
  return page(
    "Delete your account",
    `<h1>Delete your NomadSafe account</h1>
<p class="muted">NomadSafe · com.pranav.nomadsafe</p>
<div class="card">
<h2 style="margin-top:0">Fastest: delete in the app</h2>
<ol><li>Open NomadSafe and unlock it.</li><li>Go to <strong>Settings</strong>.</li><li>Tap <strong>Delete account</strong> and confirm.</li></ol>
<p>Deletion is immediate.</p>
</div>
<h2>Can't access the app?</h2>
<p>Submit the email address you signed in with. We will confirm the request by email and delete the account within 30 days.</p>
<form method="post" action="/delete-account">
<input type="email" name="email" required maxlength="254" placeholder="you@example.com" aria-label="Email address">
<textarea name="reason" maxlength="1000" rows="3" placeholder="Optional: anything we should know" aria-label="Reason"></textarea>
<button type="submit">Request deletion</button>
</form>
<h2>What gets deleted</h2>
<ul><li>Your account profile (name, email, photo) and sign-in sessions.</li>
<li>Your backed-up trips, itinerary, expenses and settlements, and your device's push tokens.</li>
<li>Your membership of shared trips. Trips you organize pass to another member who joined; if no one else joined, the trip and its shared expenses are deleted. Expenses you added to a trip others still use stay on that trip under your display name.</li>
<li>Live location shares, sharing links and invites, both sent and received.</li>
<li>Usage analytics, crash reports and session recordings linked to your account in PostHog.</li></ul>
<p>Data stored only on your phone (emergency contacts, chats, imported message text) is removed when you uninstall the app or use <em>Settings → Wipe device data</em>. Diagnostic logs expire from PostHog within 14 days. Nothing is kept after deletion except where the law requires it.</p>
<p>Questions: ${contactLine()}.</p>`,
  );
});

export const submitDeletionRequest = httpAction(async (ctx, req) => {
  const form = new URLSearchParams(await req.text().catch(() => ""));
  const email = (form.get("email") ?? "").trim();
  const reason = (form.get("reason") ?? "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return page("Invalid email", `<h1>Please enter a valid email</h1><p><a href="/delete-account">Go back</a></p>`, 400);
  }
  await ctx.runMutation(internal.account.requestDeletionByEmail, {
    email,
    reason: reason || undefined,
  });
  return page(
    "Request received",
    `<h1>Request received</h1><p>We've recorded a deletion request for <strong>${escapeHtml(email)}</strong>. We'll confirm by email and complete it within 30 days.</p>`,
  );
});

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.pranav.nomadsafe";

/** Invite link landing page: opens the app on the join screen, or points to the store. */
export const joinTripPage = httpAction(async (_ctx, req) => {
  const code = new URL(req.url).pathname.split("/").pop()?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() ?? "";
  const appLink = `nomadsafe://join/${code}`;
  return page(
    "Join a trip",
    `<h1>You're invited to a trip</h1>
<p>Open the invite in the NomadSafe app to see the trip and its shared expenses.</p>
<div class="card">
<p><a href="${escapeHtml(appLink)}"><button type="button">Open in NomadSafe</button></a></p>
<p class="muted">Invite code: <strong>${escapeHtml(code)}</strong>. In the app, go to <em>Trips → Join with code</em> if the button doesn't open it.</p>
</div>
<p>Don't have the app yet? <a href="${PLAY_STORE_URL}">Get NomadSafe on Google Play</a>, sign in, then open this link again.</p>
<script>location.href=${JSON.stringify(appLink)};</script>`,
  );
});
