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
const sharedFetch = loadModule("src/features/expenses/services/gmailSharedFetch.ts");

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
  assert.equal(parsing.gmailErrorCode(403, "User-rate limit exceeded"), "gmail-api");
  assert.equal(parsing.gmailErrorCode(403, "Gmail API has not been used in project 123"), "gmail-api");
  assert.equal(parsing.gmailErrorCode(500), "gmail-api");
});

test("builds the Gmail query with optional after/before bounds", () => {
  const base = parsing.buildGmailQuery(null, null);
  assert.match(base, /^newer_than:50d \(/);
  assert.doesNotMatch(base, /after:|before:/);

  const bounded = parsing.buildGmailQuery(1_750_000_000_500, 1_760_000_000);
  assert.ok(bounded.endsWith(" after:1750000000 before:1760000000"));
});

test("bounds the query at local midnight after the trip's last day", () => {
  const expected = Math.floor(new Date(2026, 5, 21).getTime() / 1000);
  assert.equal(parsing.gmailBeforeBound("2026-06-20"), expected);
  assert.equal(parsing.gmailBeforeBound("2026-06-20T00:00:00.000Z"), expected);
  assert.equal(parsing.gmailBeforeBound("2026-06-30"), Math.floor(new Date(2026, 6, 1).getTime() / 1000));
  assert.equal(parsing.gmailBeforeBound(null), null);
  assert.equal(parsing.gmailBeforeBound("not-a-date"), null);
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

const at = (iso) => Date.parse(iso);
const messages = [
  { body: "old", date: "2026-06-01T00:00:00.000Z" },
  { body: "new", date: "2026-06-15T00:00:00.000Z" },
];

function countingLoader(result = messages) {
  const loader = async () => {
    loader.calls += 1;
    return result;
  };
  loader.calls = 0;
  return loader;
}

test("shares one download when a cached fetch covers the range", async () => {
  sharedFetch.clearSharedGmailFetch();
  const load = countingLoader();
  const range = { since: null, before: 100 };

  const first = await sharedFetch.fetchTransactionEmailsShared("acct", range, load);
  const second = await sharedFetch.fetchTransactionEmailsShared(
    "acct",
    { since: at("2026-06-10T00:00:00.000Z"), before: 100 },
    load,
  );

  assert.equal(load.calls, 1);
  assert.equal(first.messages.length, 2);
  assert.deepEqual(second.messages.map((m) => m.body), ["new"]);
  assert.equal(second.fetchedAt, first.fetchedAt);
});

test("fetches again when the cache doesn't cover the request", async () => {
  sharedFetch.clearSharedGmailFetch();
  const load = countingLoader();
  const since = at("2026-06-10T00:00:00.000Z");

  await sharedFetch.fetchTransactionEmailsShared("acct", { since, before: 100 }, load);
  await sharedFetch.fetchTransactionEmailsShared("acct", { since: null, before: 100 }, load);
  assert.equal(load.calls, 2, "a wider window needs a new download");

  await sharedFetch.fetchTransactionEmailsShared("acct", { since: null, before: 200 }, load);
  assert.equal(load.calls, 3, "a different trip end needs a new download");

  await sharedFetch.fetchTransactionEmailsShared("other", { since: null, before: 200 }, load);
  assert.equal(load.calls, 4, "another account never reuses cached mail");

  await sharedFetch.fetchTransactionEmailsShared("other", { since: null, before: 200 }, load, { fresh: true });
  assert.equal(load.calls, 5, "fresh bypasses the cache");
});

test("concurrent callers share the in-flight download", async () => {
  sharedFetch.clearSharedGmailFetch();
  const load = countingLoader();
  const range = { since: null, before: null };
  await Promise.all([
    sharedFetch.fetchTransactionEmailsShared("acct", range, load),
    sharedFetch.fetchTransactionEmailsShared("acct", range, load),
  ]);
  assert.equal(load.calls, 1);
});

test("a failed download isn't cached", async () => {
  sharedFetch.clearSharedGmailFetch();
  const range = { since: null, before: null };
  await assert.rejects(
    sharedFetch.fetchTransactionEmailsShared("acct", range, async () => {
      throw new Error("offline");
    }),
  );
  const load = countingLoader();
  await sharedFetch.fetchTransactionEmailsShared("acct", range, load);
  assert.equal(load.calls, 1);
});
