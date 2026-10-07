import { DAY, HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const EFFECTIVE_DATE = "5 October 2026";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="ns-aurora" x1="96" y1="420" x2="416" y2="92" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#22C7B8"/><stop offset="0.55" stop-color="#5B6CFF"/><stop offset="1" stop-color="#9B7BFF"/></linearGradient></defs><rect width="512" height="512" rx="120" fill="#0B0D12"/><g transform="translate(256 256) scale(0.92) translate(-256 -285)"><path d="M184 340 V172 L328 340 V172" fill="none" stroke="url(#ns-aurora)" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/><path d="M92 380 C170 430 342 430 420 380" fill="none" stroke="#EDEFF5" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 14" opacity="0.55"/></g></svg>`;
const FAVICON = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;
const MAX_FORM_BYTES = 4096;
const MAX_REASON = 1000;

// The deletion form is unauthenticated, so it is limited per IP and overall.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  deletionRequestIp: { kind: "token bucket", rate: 5, period: HOUR, capacity: 3 },
  deletionRequestGlobal: { kind: "token bucket", rate: 200, period: DAY, capacity: 50 },
});

interface PageOptions {
  status?: number;
  // Pages that differ per visitor (the join page reads the User-Agent and carries an invite code) aren't cached.
  personal?: boolean;
}

function randomNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

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

/** HTML page with a strict CSP: only this response's own inline script and style blocks may run. */
function page(title: string, body: string, { status = 200, personal = false }: PageOptions = {}) {
  const nonce = randomNonce();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · NomadSafe</title>
<link rel="icon" href="${FAVICON}">
<style nonce="${nonce}">
body{font:16px/1.6 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:32px 20px;color:#1d2327;background:#faf7f2}
h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 8px}
.muted{color:#5f6b72;font-size:14px}ul{padding-left:20px}li{margin:4px 0}
form{display:grid;gap:12px;margin-top:16px;max-width:420px}
input,textarea,button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #cfc8bc}
button{background:#1d4d4f;color:#fff;border:0;cursor:pointer}
.card{background:#fff;border:1px solid #e6dfd3;border-radius:14px;padding:16px 18px;margin-top:16px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px;font-weight:600;font-size:18px;color:#0E1018}
.brand svg{width:40px;height:40px}
.card h2:first-child{margin-top:0}
</style></head><body><div class="brand">${LOGO_SVG}<span>NomadSafe</span></div>${body.replaceAll("<script>", `<script nonce="${nonce}">`)}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": personal ? "private, no-store" : "public, max-age=300",
      ...(personal ? { Vary: "User-Agent" } : {}),
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
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
<li>Receipt photos you scan. They are read on your phone with the system's on-device text recognition (Google ML Kit on Android, Apple Vision on iOS) and are never uploaded; only the amount, shop and date you keep become an expense.</li>
<li>AI chat history. With the on-device AI model, prompts and replies never leave your phone. When you use online AI (below), each question is sent to answer it, but the chat history is still stored only on your phone.</li>
<li>Photos you add to a trip replay: your phone looks only at the photos you pick, chooses the best ones on the device, and keeps small copies of those, with the time and place they were taken. They are never uploaded or backed up.</li>
<li>Step counts and walking distance read from Health Connect or Apple Health for a trip's dates, if you turn this on.</li>
</ul>
<p>This data is kept in encrypted app storage and is excluded from cloud backups. Trips, expenses, itinerary and the past travel in your passport are kept in the same encrypted storage on your device as well as in your account backup (below). Your passport's stamps and state map are worked out on your device from this data; country and state outlines are built into the app, so no location lookup is sent anywhere. If you add the NomadSafe home-screen widget, your trip names are also kept in the widget's own storage on your device so it can show them. Uninstalling the app or using <em>Settings → Wipe device data</em> removes it.</p>

<h2>Data stored on our servers</h2>
<ul>
<li><strong>Account:</strong> when you sign in with Google we receive your name, email address and profile photo to create your account.</li>
<li><strong>Live location sharing (optional):</strong> while you have sharing turned on, your precise location, battery level and sharing mode are sent to our server and shown only to contacts who accepted your request. This includes when the app is closed or not in use, which Android indicates with a persistent notification. We keep only your latest position per contact, not a location history. Turning sharing off marks it inactive immediately.</li>
<li><strong>Sharing contacts:</strong> the name and email address of people you invite to receive your location, and the status of those requests.</li>
<li><strong>Trip backup (on by default, can be turned off):</strong> your trips (names, destinations, dates, budget, companions) and planned trips (names, places and the month you picked), itinerary events and saved ideas (their title, the link you shared and your note), expenses (merchant, amount, category, notes, splits and the place you added), settlements and past travel you add to your passport (country, state, the place name you picked and the month) are saved to your account so they come back when you sign in on another phone. The original text of imported messages is never uploaded. Turning off <em>Settings → Back up to my account</em> deletes this copy from our servers; signing out removes it from your phone.</li>
<li><strong>Shared trips (optional):</strong> when you create an invite link for a trip or join one, the trip details, itinerary (including saved ideas and their links and notes), the expenses split with others (including where they were added), payments between members, and each member's display name are stored on our servers and shown to everyone on that trip. Anyone with the link or code can join. Expenses you don't split stay private to you. When you leave, your past shared expenses stay on the trip under your name.</li>
<li><strong>SOS and check-in alerts:</strong> when you start a safety check-in, its end time is stored on our server; when you trigger SOS, the time is stored. If a check-in runs out without you checking in, or you trigger SOS, the contacts who accepted your live-location request get a push notification with your name and that you need help (no location in the notification text), and your latest position is shared with them in the app as with live sharing. When you check in or cancel the SOS, they are told you are safe. Finishing or cancelling a check-in removes its end time.</li>
<li><strong>Notifications for shared trips:</strong> a push token for your device and your app language. When someone changes a shared expense, saves an idea to a shared planned trip or confirms one, the notification text (trip name, their name, the expense or idea name and amount, or the trip dates) goes through Expo's push service and Google Firebase Cloud Messaging or Apple Push Notification service to reach your phone. You can mute notifications per trip.</li>
</ul>
<p>Our backend is hosted by Convex (convex.dev). Data is encrypted in transit (HTTPS).</p>

<h2>Online AI (optional)</h2>
<p>By default NomadSafe's AI runs on your device. Online AI is used only when you're connected, <em>Settings → Online AI</em> is on, and either you have the Pro plan or you have added your own API key:</p>
<ul>
<li><strong>NomadSafe Cloud (Pro):</strong> your AI request is sent through our server to OpenRouter (openrouter.ai), which passes it to the AI model that generates the answer (currently an OpenAI model). A request contains what that feature needs: your chat message, recent chat turns and a summary of earlier ones, your active trip's dates, budget and spending figures, a spoken expense as text (never audio), trip destinations and length for budget and name suggestions, the titles and times of itinerary events you added yourself, for tidying the itinerary, or the text read from a receipt you choose to split item by item (never the photo). Imported message text, and merchant names read from Gmail, are never sent to online AI. We store only a monthly count of your requests per feature (for example chat replies or trip budget suggestions), to apply the plan's allowance and show you your usage, and never the content. We only allow OpenRouter to use model providers that do not store or train on requests.</li>
<li><strong>Your own API key:</strong> if you add a key for OpenAI, Anthropic, Google Gemini or another compatible provider, the same requests go directly from your phone to that provider, under your agreement with them. Your key is stored encrypted on your device only and is removed when you sign out.</li>
</ul>
<p>So you can see your usage, the app also keeps a list of your recent online AI uses (which feature, NomadSafe Cloud or your own key, and when; never what you asked) in encrypted storage on your device. It covers the current month only and is cleared when you sign out or wipe device data.</p>
<p>Turn off <em>Settings → Online AI</em> at any time to keep all AI on your device.</p>

<h2>Purchases</h2>
<p>Plans are bought through Google Play (or the App Store). We use RevenueCat to check which plan you have: it receives your NomadSafe account ID and your store purchase records (product, dates, status and price), not your payment details. Our server stores which plan you have and when it ends. Deleting your account deletes this record and your RevenueCat customer.</p>

<h2>Advertising (free plan)</h2>
<p>On the free plan, NomadSafe occasionally shows a full-screen ad from Google AdMob, at most once every few hours and only after you create a trip. Ads never appear on SOS, check-in, live location, the lock screen or voice entry. To show and measure ads, Google receives your device's advertising ID, your IP address (used for an approximate location), device and app information (such as model, OS, language and app version) and your interactions with the ads. In the EEA, the UK and Switzerland you are asked for consent first, and you can change your choice at any time in <em>Settings → Ad privacy choices</em>; without consent to personalised ads, Google shows non-personalised ads. You can also reset or delete your advertising ID in your phone's settings. No trip, expense, chat, contact or location data from NomadSafe is shared with Google or any ad partner. Google processes this data under its own <a href="https://policies.google.com/technologies/partner-sites">privacy policy</a>. Paid plans (Plus and Pro) show no ads, and the ad SDK is not started for them.</p>

<h2>Gmail import (optional)</h2>
<p>If you connect Gmail, NomadSafe requests read-only access to find booking confirmations and receipts for your trips. Emails are fetched and read on your device. The email text itself is never sent to our servers or any third party, not used for advertising, and not read by humans. The expenses (merchant, amount, date) and bookings NomadSafe creates from them are trip data like any other: they are saved in your account backup if it is on, and shown to a shared trip's members if you add them there. Merchant names and booking details read from Gmail are never sent to online AI. Access tokens are stored securely on your device, and you can disconnect at any time from the app or at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
<p>NomadSafe's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

<h2>SOS and emergency messages</h2>
<p>When you trigger SOS (in the app or from the home-screen SOS widget, after a 5-second countdown you can cancel) or a missed check-in alert, NomadSafe opens your phone's SMS app with a pre-filled message (including your location) addressed to your emergency contacts. The message is sent by your phone's SMS app, not by us, and only after you confirm it. Contacts who use NomadSafe and accepted your live-location request are also alerted by push notification, as described above.</p>

<h2>Services that receive limited data</h2>
<ul>
<li><strong>Google Places</strong> (via our server): your approximate coordinates, to suggest nearby places and emergency services; the names of places from your itinerary (such as your hotel), to show them on the map; and destination search text, to suggest and locate places not in the app's built-in city list.</li>
<li><strong>Google Maps</strong>: map tiles for locations shown in the app.</li>
<li><strong>Instagram, TikTok, YouTube and other sites you share links from</strong> (directly from your phone): when you save a link shared from another app, NomadSafe asks that site for the link's public preview (title, author and image); playing a saved reel or video in the app loads it from that site, as opening it in a browser would. The site sees your IP address and may set its own cookies.</li>
<li><strong>MET Norway</strong> (via our server): trip coordinates rounded to about 10 km, for weather forecasts and current conditions. Our server keeps a shared copy of each forecast, not linked to you, and asks MET Norway for a fixed worldwide grid of points for the globe's live cloud cover.</li>
<li><strong>Cloudflare and NASA GIBS</strong>: a rough rectangle around your trip's destinations, to download satellite imagery for the home globe from our copy on Cloudflare, or from NASA if that is unavailable.</li>
<li><strong>Frankfurter</strong>: currency pairs and dates, for exchange rates.</li>
<li><strong>Hugging Face</strong>: model download requests (your IP address), if you download an AI model.</li>
<li><strong>OpenRouter and the AI model provider it uses</strong> (via our server, Pro with Online AI on): AI requests as described under Online AI.</li>
<li><strong>The AI provider you choose</strong> (directly from your phone, if you add your own API key): AI requests as described under Online AI.</li>
<li><strong>RevenueCat and Google Play / the App Store</strong>: your account ID and purchase records, to provide paid plans.</li>
<li><strong>Google Play Integrity and Firebase App Check</strong>: device and app integrity signals (no trip, contact or location data), so our server only answers genuine copies of the app.</li>
<li><strong>Google AdMob</strong> (free plan only): advertising ID, IP-derived approximate location, device and app information and ad interactions, to show ads, as described under Advertising.</li>
<li><strong>PostHog</strong> (EU hosting): usage analytics, feature flags, session recordings, crash reports and diagnostic logs, described below.</li>
</ul>
<p class="muted">The built-in city list uses data from GeoNames (geonames.org), licensed under CC BY 4.0. It ships with the app and receives no data.</p>

<h2>Usage analytics</h2>
<p>To see which features work and which don't, and to test changes, NomadSafe sends usage analytics to PostHog, hosted in the EU. They are linked to your account ID once you sign in. They include:</p>
<ul>
<li>Which screens you open and actions you take, such as creating a trip, adding an expense, starting live sharing or triggering SOS, with counts and types only (for example "3 expenses imported from Gmail").</li>
<li>Device model, OS, app version, language and an approximate country and city derived from your IP address. Your precise location is never sent.</li>
<li>Session recordings: screenshots of the app with all text, input fields, images and maps masked. Recording pauses while the lock screen is showing.</li>
<li>Crash reports and diagnostic logs: device model, OS, app version, technical details of the error, and counts (for example "12 emails scanned, 3 expenses found").</li>
</ul>
<p>Analytics never include your trip names or destinations, expense amounts or merchants, notes, chats, emails, contacts or location. You can turn analytics, crash reports and logs off at any time in <em>Settings → Share usage analytics</em>. Analytics and crash reports are kept for up to 12 months, diagnostic logs for 14 days and session recordings for up to 30 days.</p>
<p>We do not sell your data or share it with data brokers, and apart from the free-plan ads described above, we do not use it for advertising.</p>

<h2>Permissions</h2>
<ul>
<li><strong>Location, including background:</strong> live location sharing, SOS location and nearby places. Background location is used only while you have live sharing turned on.</li>
<li><strong>Contacts:</strong> only to let you pick emergency contacts. We read the contact you pick; your address book is not uploaded.</li>
<li><strong>Microphone and speech recognition:</strong> only when you tap Speak to add an expense by voice. Your phone's on-device speech recognizer turns speech into text; audio is never recorded or sent anywhere. The on-device AI reads the text, or, when online AI is in use, the text alone is sent to read the amount and who it is split with, as described under Online AI.</li>
<li><strong>Photos:</strong> NomadSafe has no access to your photo library. When you add photos to a trip replay, the system photo picker gives the app only the photos you pick.</li>
<li><strong>Health Connect / Apple Health (steps and distance, read only):</strong> only after you tap Add steps on a finished trip. NomadSafe reads your step count and walking distance for that trip's dates, including dates more than 30 days ago, to show how far you walked in its replay. This data is read and kept on your device; it is never uploaded, shared, used for advertising or written back. You can withdraw access at any time in Health Connect or the Health app.</li>
<li><strong>Notifications:</strong> check-in reminders, sharing status, download progress, SOS and missed check-in alerts from your contacts, and changes to shared trips.</li>
<li><strong>Biometrics:</strong> to unlock the app. Biometric data never leaves your device's secure hardware.</li>
</ul>

<h2>Retention and deletion</h2>
<p>You can delete your account at any time in <em>Settings → Delete account</em>. This immediately deletes your account, sessions, trip backup, push tokens, check-in and SOS records, sharing links, location shares, invites, plan record and AI usage counts from our servers, and your RevenueCat customer. You leave your shared trips: trips you organize pass to another member who joined, or are deleted if no one else joined, and expenses you added to a trip others still use stay on it under your display name. Store subscriptions are managed by Google Play or the App Store, so cancel any active subscription there. Your usage analytics, crash reports and session recordings are deleted from PostHog within a few days, and diagnostic logs expire within 14 days. You can also <a href="/delete-account">request deletion on the web</a>. Otherwise, usage analytics and crash reports are retained by PostHog for up to 12 months and session recordings for up to 30 days.</p>

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
<h2>Fastest: delete in the app</h2>
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
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_FORM_BYTES) {
    return page("Request too large", `<h1>Request too large</h1><p><a href="/delete-account">Go back</a></p>`, { status: 413 });
  }
  const form = new URLSearchParams(raw);
  const email = (form.get("email") ?? "").trim();
  const reason = (form.get("reason") ?? "").trim().slice(0, MAX_REASON);
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return page("Invalid email", `<h1>Please enter a valid email</h1><p><a href="/delete-account">Go back</a></p>`, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64);
  const perIp = ip ? await rateLimiter.limit(ctx, "deletionRequestIp", { key: ip }) : { ok: true };
  const overall = perIp.ok ? await rateLimiter.limit(ctx, "deletionRequestGlobal", { key: "global" }) : { ok: false };
  if (!overall.ok) {
    return page("Try again later", `<h1>Too many requests</h1><p>Please try again in an hour, or contact ${contactLine()}.</p>`, { status: 429 });
  }
  await ctx.runMutation(internal.account.requestDeletionByEmail, {
    email,
    reason: reason || undefined,
  });
  return page(
    "Request received",
    `<h1>Request received</h1><p>We've recorded a deletion request for <strong>${escapeHtml(email)}</strong>. We'll confirm by email and complete it within 30 days.</p>`,
    { personal: true },
  );
});

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.pranav.nomadsafe";

const IOS_UA = /iPhone|iPad|iPod/i;

/**
 * Store link that carries the invite through the install: Play's install referrer on Android; on
 * iOS a tap copies the invite URL, which the app reads from the clipboard on first launch.
 */
function joinStoreLink(url: URL, code: string, ios: boolean) {
  if (!ios) {
    const playUrl = `${PLAY_STORE_URL}&referrer=${encodeURIComponent(`join=${code}`)}`;
    return `<p>Don't have the app yet? <a href="${escapeHtml(playUrl)}">Get NomadSafe on Google Play</a>. Your invite opens once you've signed in.</p>`;
  }
  const appStoreUrl = process.env.IOS_APP_STORE_URL;
  if (!appStoreUrl) {
    return `<p>NomadSafe for iPhone is coming soon. Keep your invite code to join the trip once it's out.</p>`;
  }
  const inviteUrl = `${url.origin}/join/${code}`;
  // text/uri-list makes the copy a URL on iOS, so the app can check for it without a paste prompt.
  const copyAndGo = `async function getApp(){var u=${JSON.stringify(inviteUrl)};try{await navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob([u],{type:"text/plain"}),"text/uri-list":new Blob([u],{type:"text/uri-list"})})]);}catch(e){try{await navigator.clipboard.writeText(u);}catch(e2){}}location.href=${JSON.stringify(appStoreUrl)};}`;
  return `<p>Don't have the app yet?</p>
<p><button type="button" id="get-app">Get NomadSafe on the App Store</button></p>
<p class="muted">This copies your invite so NomadSafe can open it after you install. Allow the paste prompt when the app asks.</p>
<script>${copyAndGo}document.getElementById("get-app").addEventListener("click",getApp);</script>`;
}

/** Invite link landing page: opens the app on the join screen, or points to the store. */
export const joinTripPage = httpAction(async (_ctx, req) => {
  const url = new URL(req.url);
  const code = url.pathname.split("/").pop()?.replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toUpperCase() ?? "";
  const appLink = `nomadsafe://join/${code}`;
  const ios = IOS_UA.test(req.headers.get("user-agent") ?? "");
  return page(
    "Join a trip",
    `<h1>You're invited to a trip</h1>
<p>Open the invite in the NomadSafe app to see the trip and its shared expenses.</p>
<div class="card">
<p><a href="${escapeHtml(appLink)}"><button type="button">Open in NomadSafe</button></a></p>
<p class="muted">Invite code: <strong>${escapeHtml(code)}</strong>. In the app, go to <em>Trips → Join with code</em> if the button doesn't open it.</p>
</div>
${joinStoreLink(url, code, ios)}
<script>location.href=${JSON.stringify(appLink)};</script>`,
    { personal: true },
  );
});
