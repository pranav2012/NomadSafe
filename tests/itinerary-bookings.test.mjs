import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({ entryPoints: [entryPoint], bundle: true, format: "cjs", platform: "node", target: "node20", write: false })
    .outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const bookings = loadModule("src/features/itinerary/utils/bookings.ts");

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
let seq = 0;
const event = (fields) => ({
  id: `e${++seq}`,
  tripId: "tokyo",
  source: "email",
  createdAt: new Date(2026, 8, 1, 0, seq).toISOString(),
  ...fields,
});

test("treats booking-site and booking-kind titles as generic", () => {
  assert.ok(bookings.isGenericTitle("Booking"));
  assert.ok(bookings.isGenericTitle("Booking.com"));
  assert.ok(!bookings.isGenericTitle("Maple Leaf Hostel Asakusa"));
});

test("recognises emails about the same stay despite different titles", () => {
  const stay = { type: "stay", title: "Maple Leaf Hostel Asakusa", startAt: at(2026, 10, 10, 15), endAt: at(2026, 10, 18, 11) };
  assert.ok(bookings.sameBooking(stay, { ...stay, title: "Maple Leaf Hostel Asakusa Booking" }));
  assert.ok(bookings.sameBooking(stay, { ...stay, title: "Booking" }));
  assert.ok(bookings.sameBooking(stay, { type: "stay", title: "Booking", startAt: at(2026, 10, 9), endAt: at(2026, 10, 18, 11) }), "same check-out");
  assert.ok(!bookings.sameBooking(stay, { ...stay, title: "Kyoto Machiya Inn", startAt: at(2026, 10, 18), endAt: at(2026, 10, 22) }));
  assert.ok(!bookings.sameBooking(stay, { ...stay, type: "transit" }));
});

test("flights match on day and route; activities need matching titles", () => {
  const flight = { type: "transit", title: "Air India", detail: "BLR → NRT", startAt: at(2026, 10, 10, 9) };
  assert.ok(bookings.sameBooking(flight, { ...flight, title: "Flight" }));
  assert.ok(!bookings.sameBooking(flight, { ...flight, detail: "NRT → KIX" }));
  const tour = { type: "activity", title: "teamLab Planets", startAt: at(2026, 10, 12, 10) };
  assert.ok(!bookings.sameBooking(tour, { ...tour, title: "Activity" }), "a generic activity isn't merged into a named one");
});

test("merging keeps the cleanest title, fills gaps and collects source ids", () => {
  const patch = bookings.mergeBooking(
    { type: "stay", title: "Maple Leaf Hostel Asakusa Booking", startAt: at(2026, 10, 10), externalId: "gmail:a#0" },
    { type: "stay", title: "Maple Leaf Hostel Asakusa", startAt: at(2026, 10, 10), endAt: at(2026, 10, 18), externalId: "gmail:b#0" },
  );
  assert.equal(patch.title, "Maple Leaf Hostel Asakusa");
  assert.equal(patch.endAt, at(2026, 10, 18));
  assert.deepEqual(patch.sourceIds, ["gmail:a#0", "gmail:b#0"]);
  assert.equal(bookings.mergeBooking({ type: "stay", title: "Maple Leaf", startAt: at(2026, 10, 10) }, { type: "stay", title: "Booking", startAt: at(2026, 10, 10) }).title, "Maple Leaf");
});

test("cleans up old check-in/check-out pairs and repeated emails into one stay", () => {
  const events = [
    event({ type: "stay", title: "Maple Leaf Hostel Asakusa Booking", detail: "Check-in", startAt: at(2026, 10, 10, 15), externalId: "gmail:a#0" }),
    event({ type: "stay", title: "Maple Leaf Hostel Asakusa Booking", detail: "Check-out", startAt: at(2026, 10, 18, 11), externalId: "gmail:a#1" }),
    event({ type: "stay", title: "Booking", detail: "Check-in", startAt: at(2026, 10, 10, 15), externalId: "gmail:b#0" }),
    event({ type: "stay", title: "Booking", detail: "Check-out", startAt: at(2026, 10, 18, 11), externalId: "gmail:b#1" }),
    event({ type: "stay", title: "Maple Leaf Hostel Asakusa", detail: "Check-out", startAt: at(2026, 10, 18, 11), externalId: "gmail:c#0" }),
    event({ type: "transit", title: "Air India", detail: "Departure · BLR → NRT", startAt: at(2026, 10, 10, 9), externalId: "gmail:d#0" }),
    event({ type: "transit", title: "Air India", detail: "Arrival · BLR → NRT", startAt: at(2026, 10, 10, 18), externalId: "gmail:d#1" }),
    event({ type: "activity", title: "Dinner", startAt: at(2026, 10, 11, 19), source: "manual" }),
  ];
  const result = bookings.consolidateEmailBookings(events);
  const stays = result.filter((e) => e.type === "stay");
  assert.equal(stays.length, 1);
  assert.equal(stays[0].title, "Maple Leaf Hostel Asakusa");
  assert.equal(stays[0].startAt, at(2026, 10, 10, 15));
  assert.equal(stays[0].endAt, at(2026, 10, 18, 11));
  assert.equal(stays[0].detail, undefined);
  assert.equal(stays[0].sourceIds.length, 5);

  const flights = result.filter((e) => e.type === "transit");
  assert.equal(flights.length, 1);
  assert.equal(flights[0].detail, "BLR → NRT");
  assert.equal(flights[0].endAt, at(2026, 10, 10, 18));
  assert.ok(result.some((e) => e.title === "Dinner"), "manual events are untouched");
});

test("cleanup never merges bookings across trips", () => {
  const a = event({ type: "stay", title: "Booking", detail: "Check-in", startAt: at(2026, 10, 10) });
  const b = event({ type: "stay", title: "Booking", detail: "Check-in", startAt: at(2026, 10, 10), tripId: "other" });
  assert.equal(bookings.consolidateEmailBookings([a, b]).length, 2);
});

const timeline = loadModule("src/features/itinerary/utils/timeline.ts");

test("counts nights by calendar day", () => {
  assert.equal(timeline.nightsBetween(at(2026, 10, 10, 15), at(2026, 10, 18, 11)), 8);
  assert.equal(timeline.nightsBetween(at(2026, 10, 10, 23), at(2026, 10, 11, 1)), 1);
});

test("up next includes a stay in progress and skips what's over", () => {
  const stay = { type: "stay", title: "Maple Leaf", startAt: at(2026, 10, 10, 15), endAt: at(2026, 10, 18, 11) };
  const flight = { type: "transit", title: "Air India", startAt: at(2026, 10, 10, 9) };
  const tour = { type: "activity", title: "teamLab", startAt: at(2026, 10, 12, 10) };
  const now = new Date(2026, 9, 11).getTime();
  assert.deepEqual(timeline.upNext([tour, stay, flight], now, 3).map((e) => e.title), ["Maple Leaf", "teamLab"]);
  assert.deepEqual(timeline.upNext([flight], new Date(2026, 11, 1).getTime(), 3).map((e) => e.title), ["Air India"], "falls back to the last items");
});

test("the timeline shows a stay once at each end and collapses the quiet days between", () => {
  const stay = { type: "stay", title: "Maple Leaf", startAt: at(2026, 10, 10, 15), endAt: at(2026, 10, 18, 11) };
  const flight = { type: "transit", title: "Air India", startAt: at(2026, 10, 10, 9) };
  const tour = { type: "activity", title: "teamLab", startAt: at(2026, 10, 12, 10) };
  const sections = timeline.buildTimeline([stay, flight, tour]);
  const summary = sections.map((s) =>
    s.kind === "day"
      ? `${s.day.getDate()}:${s.entries.map((e) => `${e.event.title}/${e.role}`).join(",")}`
      : `staying ${s.from.getDate()}-${s.to.getDate()}`,
  );
  assert.deepEqual(summary, [
    "10:Air India/single,Maple Leaf/check-in",
    "staying 11-11",
    "12:teamLab/single",
    "staying 13-17",
    "18:Maple Leaf/check-out",
  ]);
});

test("quiet stay days step by calendar day across a DST change", () => {
  const previousTz = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    // Clocks go back on 25 Oct 2026 in Berlin, so that day is 25 hours long.
    const stay = { type: "stay", title: "Pine Lodge", startAt: "2026-10-23T15:00:00", endAt: "2026-10-28T10:00:00" };
    const summary = timeline.buildTimeline([stay]).map((s) =>
      s.kind === "day" ? `${s.day.getDate()}:${s.entries[0].role}` : `staying ${s.from.getDate()}-${s.to.getDate()}`,
    );
    assert.deepEqual(summary, ["23:check-in", "staying 24-27", "28:check-out"]);
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test("booking numbers decide: same number is one booking, different numbers stay apart", () => {
  const a = { type: "stay", title: "Maple Leaf", startAt: "2026-10-18T15:00:00", endAt: "2026-10-21T10:00:00", bookingRef: "111" };
  assert.ok(!bookings.sameBooking(a, { ...a, endAt: "2026-10-20T10:00:00", bookingRef: "222" }), "two bookings at one hostel");
  assert.ok(bookings.sameBooking(a, { ...a, startAt: "2026-10-19T15:00:00", bookingRef: "111" }), "same booking, new dates");
});

test("a newer email for the same booking number replaces its dates", () => {
  const patch = bookings.mergeBooking(
    { type: "stay", title: "Pine Lodge", startAt: "2026-10-27T15:00:00", endAt: "2026-10-28T10:00:00", bookingRef: "333", externalId: "gmail:a#0" },
    { type: "stay", title: "Pine Lodge", startAt: "2026-10-28T15:00:00", endAt: "2026-10-29T10:00:00", bookingRef: "333", externalId: "gmail:b#0" },
  );
  assert.equal(patch.startAt, "2026-10-28T15:00:00");
  assert.equal(patch.endAt, "2026-10-29T10:00:00");
  assert.deepEqual(patch.sourceIds, ["gmail:a#0", "gmail:b#0"]);
});
