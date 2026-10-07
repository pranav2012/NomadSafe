import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const parsing = loadModule("src/features/expenses/services/gmailParsing.ts");
const tripFilter = loadModule("src/features/expenses/services/tripEmailFilter.ts");
const coverage = loadModule("src/features/expenses/services/tripGmailCoverage.ts");

const b64 = (text) => Buffer.from(text, "utf8").toString("base64url");
const part = (mimeType, text) => ({ mimeType, body: { data: b64(text) } });

test("prefers text/plain over HTML in a multipart/alternative email", () => {
  const message = {
    payload: {
      mimeType: "multipart/alternative",
      parts: [part("text/plain", "Paid ₹450 at Cafe"), part("text/html", "<p>Paid <b>₹450</b></p>")],
    },
  };
  assert.equal(parsing.extractBody(message), "Paid ₹450 at Cafe");
});

test("falls back to stripped HTML, dropping styles, scripts and entities", () => {
  const html = [
    "<html><head><style>.x{color:red}</style><script>track()</script></head>",
    "<body><p>Total&nbsp;paid:</p><p>THB&#160;1,276 &amp; tax &#x20B9;</p></body></html>",
  ].join("");
  const body = parsing.extractBody({ payload: part("text/html", html) });
  assert.equal(body, "Total paid: THB 1,276 & tax ₹");
});

test("walks nested MIME parts to find the body", () => {
  const message = {
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "multipart/alternative", parts: [part("text/plain", "Booking confirmed in Phuket")] },
        { mimeType: "application/pdf", body: {} },
      ],
    },
  };
  assert.equal(parsing.extractBody(message), "Booking confirmed in Phuket");
});

test("decodes URL-safe base64 with multi-byte UTF-8", () => {
  const text = "Café ₹ 1,200 ???~~~ 東京";
  const encoded = b64(text);
  assert.match(encoded, /[-_]/);
  assert.equal(parsing.decodeBase64Url(encoded), text);
  assert.equal(parsing.decodeBase64Url("%%%not-base64"), "");
});

test("decodes quoted-printable HTML bodies, including soft line breaks", () => {
  const html = "<p>Total =E2=82=B9 4=\r\n50</p>";
  assert.equal(parsing.extractBody({ payload: part("text/html", html) }), "Total ₹ 450");
});

test("reads headers case-insensitively", () => {
  const message = { payload: { headers: [{ name: "SUBJECT", value: "Your receipt" }] } };
  assert.equal(parsing.headerValue(message, "Subject"), "Your receipt");
  assert.equal(parsing.headerValue(message, "From"), undefined);
});

test("treats only invalid tokens and missing scopes as a dead grant", () => {
  assert.equal(parsing.gmailErrorCode(401, "Invalid Credentials"), "gmail-auth");
  assert.equal(parsing.gmailErrorCode(403, "Request had insufficient authentication scopes."), "gmail-auth");
  assert.equal(parsing.gmailErrorCode(403, "Gmail API has not been used in project 123"), "gmail-api");
  assert.equal(parsing.gmailErrorCode(500), "gmail-api");
});

test("classifies quota and rate-limit responses as retryable rate limits", () => {
  assert.equal(parsing.gmailErrorCode(429), "gmail-rate-limit");
  assert.equal(parsing.gmailErrorCode(403, "User-rate limit exceeded"), "gmail-rate-limit");
  assert.equal(
    parsing.gmailErrorCode(
      403,
      "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'",
    ),
    "gmail-rate-limit",
  );
});

test("backs off exponentially with jitter, honouring Retry-After", () => {
  assert.equal(parsing.gmailRetryDelayMs(0, null, 0), 2_000);
  assert.equal(parsing.gmailRetryDelayMs(2, null, 0), 8_000);
  assert.equal(parsing.gmailRetryDelayMs(10, null, 0), 32_000, "capped");
  assert.equal(parsing.gmailRetryDelayMs(0, null, 0.5), 2_500);
  assert.equal(parsing.gmailRetryDelayMs(0, "7", 0.5), 7_000);
  assert.equal(parsing.gmailRetryDelayMs(1, "not-a-number", 0), 4_000);
});

const DAY = 86_400_000;
const tokyo = { startDate: "2026-10-10", endDate: "2026-10-29", destinations: ["Tokyo, Japan"] };
const tokyoStart = new Date(2026, 9, 10).getTime();
const tokyoEnd = new Date(2026, 9, 30).getTime();

test("a trip's mail window runs from 60 days before it starts to midnight after it ends", () => {
  const window = parsing.tripMailWindow(tokyo);
  assert.equal(window.tripStart, tokyoStart);
  assert.equal(window.end, tokyoEnd);
  assert.equal(window.from, new Date(2026, 9, 10).getTime() - 60 * DAY);
  assert.equal(parsing.tripMailWindow({ startDate: "2026-10-10", endDate: "2026-10-01" }), null);
  assert.equal(parsing.tripMailWindow({ startDate: "not-a-date", endDate: "2026-10-01" }), null);
});

test("searches destination names, their words and accent-free spellings", () => {
  assert.deepEqual(parsing.destinationSearchTerms(["Tokyo, Japan"]), ["tokyo", "japan"]);
  const terms = parsing.destinationSearchTerms(["Phú Quốc", "Ho Chi Minh City"]);
  assert.ok(terms.includes("phú quốc") && terms.includes("phu quoc"));
  assert.ok(terms.includes("ho chi minh city"));
  assert.ok(!terms.includes("city"), "generic place words alone are too broad");
});

test("before the trip, the query only asks for bookings that name a destination", () => {
  const query = parsing.buildTripGmailQuery(tokyo, tokyoStart - 60 * DAY, tokyoStart - 5 * DAY);
  assert.match(query, /^-category:promotions -category:social after:\d+ before:\d+ \(before:\d+ \(flight OR /);
  assert.match(query, /\("tokyo" OR "japan"\)\)$/);
  assert.doesNotMatch(query, /receipt/, "pre-trip spends are never imported");
});

test("a window spanning the trip start asks for pre-trip bookings or anything during the trip", () => {
  const query = parsing.buildTripGmailQuery(tokyo, tokyoStart - DAY, tokyoStart + DAY);
  const start = tokyoStart / 1000;
  assert.ok(query.includes(`(before:${start} (flight OR`));
  assert.ok(query.includes(` OR (after:${start} (flight OR`));
  assert.ok(query.includes("receipt OR invoice"));
});

test("without destinations, mail before the trip isn't searched at all", () => {
  const trip = { ...tokyo, destinations: [] };
  assert.equal(parsing.buildTripGmailQuery(trip, tokyoStart - 30 * DAY, tokyoStart - DAY), null);
  assert.match(parsing.buildTripGmailQuery(trip, tokyoStart - 30 * DAY, tokyoStart + DAY), /\(after:\d+ \(flight/);
});


const trip = {
  id: "trip-1",
  destinations: ["Phuket, Thailand", "Phú Quốc"],
  startDate: "2026-06-10",
  endDate: "2026-06-20",
};

const email = (date, body, sender = "noreply@example.com") => ({ date, body, sender });

test("keeps mail received during the trip", () => {
  assert.equal(tripFilter.tripMatchReason(email("2026-06-12T12:00:00.000Z", "Rs 500 spent at 7-Eleven"), trip), null);
  assert.equal(tripFilter.tripMatchReason(email("2026-06-20T12:00:00.000Z", "Paid THB 300"), trip), null);
});

test("rejects mail received after the trip ends", () => {
  assert.equal(
    tripFilter.tripMatchReason(email("2026-06-21T12:00:00.000Z", "Hotel booking in Phuket"), trip),
    "after-trip",
  );
});

test("keeps pre-trip bookings that name a destination, ignoring accents", () => {
  assert.equal(
    tripFilter.tripMatchReason(email("2026-05-01T12:00:00.000Z", "Your hotel booking in Phuket is confirmed"), trip),
    null,
  );
  assert.equal(
    tripFilter.tripMatchReason(email("2026-05-01T12:00:00.000Z", "Flight to Phu Quoc confirmed"), trip),
    null,
  );
});

test("rejects pre-trip mail that isn't a booking or names another place", () => {
  assert.equal(
    tripFilter.tripMatchReason(email("2026-05-01T12:00:00.000Z", "Rs 500 spent at Phuket Cafe"), trip),
    "pretrip-not-booking",
  );
  assert.equal(
    tripFilter.tripMatchReason(email("2026-05-01T12:00:00.000Z", "Your hotel booking in Lisbon is confirmed"), trip),
    "pretrip-destination-mismatch",
  );
});

test("rejects mail with a missing or invalid date", () => {
  assert.equal(tripFilter.tripMatchReason(email(undefined, "Hotel booking"), trip), "invalid-email-date");
  assert.equal(tripFilter.tripMatchReason(email("garbage", "Hotel booking"), trip), "invalid-email-date");
});

const account = "me@example.com";
const now = new Date(2026, 9, 4, 8, 0).getTime();

test("the first scan covers the whole window up to now", () => {
  const window = coverage.nextGmailScanWindow(tokyo, null, account, now);
  assert.deepEqual(window, { after: tokyoStart - 60 * DAY, before: now });
});

test("a later open only reads mail since the last check, with a small overlap", () => {
  const first = coverage.nextGmailScanWindow(tokyo, null, account, now);
  const saved = coverage.coverageAfterScan(tokyo, account, first, null);
  const later = now + 3 * DAY;
  const window = coverage.nextGmailScanWindow(tokyo, saved, account, later);
  assert.deepEqual(window, { after: now - 10 * 60_000, before: later });
  assert.equal(coverage.coverageAfterScan(tokyo, account, window, saved).from, first.after, "keeps the earlier coverage");
});

test("an up-to-date trip needs no Gmail calls", () => {
  const saved = coverage.coverageAfterScan(tokyo, account, { after: tokyoStart - 60 * DAY, before: now }, null);
  assert.equal(coverage.nextGmailScanWindow(tokyo, saved, account, now + 30_000), null);
});

test("a finished, fully checked trip is never scanned again", () => {
  const saved = coverage.coverageAfterScan(tokyo, account, { after: tokyoStart - 60 * DAY, before: tokyoEnd }, null);
  assert.equal(coverage.nextGmailScanWindow(tokyo, saved, account, tokyoEnd + 90 * DAY), null);
});

test("a later end date only adds the new days", () => {
  const saved = coverage.coverageAfterScan(tokyo, account, { after: tokyoStart - 60 * DAY, before: tokyoEnd }, null);
  const extended = { ...tokyo, endDate: "2026-11-02" };
  const window = coverage.nextGmailScanWindow(extended, saved, account, tokyoEnd + 90 * DAY);
  assert.deepEqual(window, { after: tokyoEnd - 10 * 60_000, before: new Date(2026, 10, 3).getTime() });
});

test("a new start date, destination or Gmail account rescans the whole trip", () => {
  const saved = coverage.coverageAfterScan(tokyo, account, { after: tokyoStart - 60 * DAY, before: now }, null);
  const full = (trip, who = account) => coverage.nextGmailScanWindow(trip, saved, who, now + DAY);
  assert.equal(full({ ...tokyo, startDate: "2026-10-08" }).after, new Date(2026, 9, 8).getTime() - 60 * DAY);
  assert.equal(full({ ...tokyo, destinations: ["Tokyo, Japan", "Kyoto"] }).after, tokyoStart - 60 * DAY);
  assert.equal(full(tokyo, "other@example.com").after, tokyoStart - 60 * DAY);
  assert.equal(full({ ...tokyo, destinations: [" tokyo, japan "] }).after, now - 10 * 60_000, "case and spacing don't count");
});

test("a trip more than 60 days away has nothing to scan yet", () => {
  assert.equal(coverage.nextGmailScanWindow(tokyo, null, account, tokyoStart - 61 * DAY), null);
});

test("stored email text keeps only its start, on a code point boundary", () => {
  const { trimStoredEmailText, trimStoredEmailRecord, MAX_STORED_EMAIL_CHARS } = loadModule("src/features/expenses/utils/emailText.ts");
  assert.equal(trimStoredEmailText("short"), "short");
  const long = `${"a".repeat(MAX_STORED_EMAIL_CHARS - 2)}😀${"b".repeat(50)}`;
  const trimmed = trimStoredEmailText(long);
  assert.ok(trimmed.length <= MAX_STORED_EMAIL_CHARS);
  assert.ok(trimmed.endsWith("…"));
  assert.ok(!/[\uD800-\uDBFF]…$/.test(trimmed));
  const manual = { source: "manual", note: "x".repeat(5000) };
  assert.equal(trimStoredEmailRecord(manual), manual);
  const email = trimStoredEmailRecord({ source: "email", note: "x".repeat(5000), rawText: "y".repeat(5000) });
  assert.ok(email.note.length <= MAX_STORED_EMAIL_CHARS && email.rawText.length <= MAX_STORED_EMAIL_CHARS);
});
