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

const { toWallClock } = loadModule("src/features/itinerary/utils/wallClock.ts");
const shape = loadModule("src/features/itinerary/utils/dayShape.ts");
const { countryMealWindows } = loadModule("src/features/itinerary/data/mealTimes.ts");

const at = (d, h, m = 0) => toWallClock(new Date(2026, 9, d, h, m));
let seq = 0;
const event = (fields) => ({ id: `e${++seq}`, tripId: "tokyo", source: "manual", createdAt: "", ...fields });
const shinjuku = { latitude: 35.6938, longitude: 139.7034 };
const shibuya = { latitude: 35.658, longitude: 139.7016 };
const nearShinjuku = { latitude: 35.6955, longitude: 139.7 };
const day = (d) => new Date(2026, 9, d);
const meals = countryMealWindows("JP");

test("moves are walks nearby, transit across town and drives further out", () => {
  assert.equal(shape.estimateMove(shinjuku, nearShinjuku).mode, "walk");
  const across = shape.estimateMove(shinjuku, shibuya);
  assert.equal(across.mode, "transit");
  assert.ok(across.minutes >= 15 && across.minutes <= 30, `${across.minutes}`);
  assert.equal(shape.estimateMove(shinjuku, { latitude: 35.3606, longitude: 138.7274 }).mode, "drive");
  assert.equal(shape.estimateMove(shinjuku, shinjuku), null);
  assert.equal(shape.estimateMove(shinjuku, null), null);
});

test("lengths come from the end time, then the title, then the trip's habit, then the type", () => {
  assert.deepEqual(shape.itemMinutes({ type: "activity", title: "teamLab", startAt: at(19, 14), endAt: at(19, 16, 30) }), { minutes: 150, estimated: false });
  assert.deepEqual(shape.itemMinutes({ type: "activity", title: "Mt Fuji day trip", startAt: at(19, 8) }), { minutes: 240, estimated: true });
  assert.deepEqual(shape.itemMinutes({ type: "food", title: "Coffee at Fuglen", startAt: at(19, 8) }), { minutes: 45, estimated: true });
  assert.deepEqual(shape.itemMinutes({ type: "activity", title: "Senso-ji", startAt: at(19, 8) }), { minutes: 120, estimated: true });
  const learned = shape.learnedMinutes([1, 2, 3].map((i) => ({ type: "activity", title: `a${i}`, startAt: at(19 + i, 10), endAt: at(19 + i, 11) })));
  assert.equal(learned.activity, 60);
  assert.deepEqual(shape.itemMinutes({ type: "activity", title: "Senso-ji", startAt: at(19, 8) }, learned), { minutes: 60, estimated: true });
});

test("meal windows follow the country and shift to the trip's own meals", () => {
  assert.deepEqual(countryMealWindows("ES").dinner, [21 * 60, 23 * 60]);
  assert.deepEqual(countryMealWindows("XX").lunch, [12 * 60, 14 * 60]);
  const lateLunches = [20, 21].map((d) => event({ type: "food", title: "Lunch", startAt: at(d, 14) }));
  assert.deepEqual(shape.mealWindowsFor("JP", lateLunches).lunch, [13 * 60, 15 * 60]);
  assert.deepEqual(shape.mealWindowsFor("JP", lateLunches).dinner, meals.dinner);
});

test("landing to check-in: airport exit, the ride in, then free time with lunch and a note about bags", () => {
  const flight = event({ type: "transit", transitMode: "flight", title: "JL754", detail: "BLR → NRT", startAt: at(17, 22), endAt: at(18, 7, 40) });
  const hotel = event({ type: "stay", title: "Hotel Gracery", startAt: at(18, 15), endAt: at(21, 11), place: shinjuku });
  const entries = shape.dayEntries([flight, hotel], day(18));
  assert.deepEqual(entries.map((entry) => entry.role), ["arrival", "check-in"]);
  const result = shape.dayShape(entries, { day: day(18), meals });
  const gaps = result.after[entries[0].event.id + "-arrival"];
  assert.deepEqual(gaps.map((gap) => gap.kind), ["exit", "move", "free"]);
  assert.equal(gaps[0].international, true);
  assert.equal(gaps[0].minutes, 45);
  assert.equal(gaps[1].estimate.mode, "drive");
  assert.equal(gaps[2].meal, "lunch");
  assert.equal(gaps[2].bags, true);
  assert.deepEqual(result.openMeals, ["lunch", "dinner"]);
});

test("free windows need an hour after the move; tight moves are flagged only for known end times", () => {
  const a = event({ type: "activity", title: "Meiji Shrine", startAt: at(19, 9), endAt: at(19, 10), place: shibuya });
  const b = event({ type: "activity", title: "Golden Gai", startAt: at(19, 10, 10), place: shinjuku });
  const tight = shape.dayShape(shape.dayEntries([a, b], day(19)), { day: day(19), meals });
  const gaps = tight.after[`${a.id}-single`];
  assert.equal(gaps[0].kind, "move");
  assert.equal(gaps[0].tight, true);
  assert.ok(!gaps.some((gap) => gap.kind === "free" && !gap.meal));

  const c = event({ type: "activity", title: "Museum", startAt: at(19, 9), place: shibuya });
  const d = event({ type: "activity", title: "Golden Gai", startAt: at(19, 11, 10), place: shinjuku });
  const estimated = shape.dayShape(shape.dayEntries([c, d], day(19)), { day: day(19), meals });
  assert.equal(estimated.after[`${c.id}-single`][0].tight, false);
});

test("a planned meal covers its window and a show over dinner time leaves no dinner nudge", () => {
  const lunch = event({ type: "food", title: "Ichiran", startAt: at(20, 12), place: shinjuku });
  const show = event({ type: "activity", title: "Kabuki show", startAt: at(20, 18), place: shinjuku });
  const result = shape.dayShape(shape.dayEntries([lunch, show], day(20)), { day: day(20), meals });
  assert.deepEqual(result.openMeals, []);
});

test("before a flight you need to be at the airport early", () => {
  const out = event({ type: "stay", title: "Hotel Gracery", detail: "Check-out", startAt: at(21, 11), place: shinjuku });
  const flight = event({ type: "transit", transitMode: "flight", title: "JL753", detail: "NRT → BLR", startAt: at(21, 18) });
  const result = shape.dayShape(shape.dayEntries([out, flight], day(21)), { day: day(21), meals });
  const kinds = result.after[`${out.id}-check-out`].map((gap) => gap.kind);
  assert.deepEqual(kinds.slice(0, 2), ["move", "board"]);
  assert.equal(result.after[`${out.id}-check-out`][1].minutes, 120);
});

test("missing info: tickets for bookings and transit, places only after a failed lookup", () => {
  const tour = event({ type: "activity", title: "Sumo tour", startAt: at(19, 9) });
  assert.deepEqual(shape.missingInfo(tour, { hasTicket: false, placeFailed: false }), ["ticket"]);
  assert.deepEqual(shape.missingInfo(tour, { hasTicket: true, placeFailed: true }), ["place"]);
  const walk = event({ type: "activity", title: "Walk around Yanaka", startAt: at(19, 9) });
  assert.deepEqual(shape.missingInfo(walk, { hasTicket: false, placeFailed: false }), []);
  const cab = event({ type: "transit", transitMode: "car", title: "Taxi", startAt: at(19, 9) });
  assert.deepEqual(shape.missingInfo(cab, { hasTicket: false, placeFailed: false }), []);
});

test("trip at a glance: landing, tonight's stay, nights without one and how full each day is", () => {
  const flight = event({ type: "transit", transitMode: "flight", title: "JL754", detail: "BLR → NRT", startAt: at(17, 22), endAt: at(18, 7, 40) });
  const hotel = event({ type: "stay", title: "Hotel Gracery", startAt: at(18, 15), endAt: at(20, 11), place: shinjuku });
  const tour = event({ type: "activity", title: "Sumo tour", startAt: at(19, 9), place: shibuya });
  const days = [day(18), day(19), day(20), day(21)];
  const glance = shape.tripGlance([flight, hotel, tour], days, { mealsOn: () => meals, missingOf: (e) => shape.missingInfo(e, { hasTicket: false, placeFailed: false }) });
  assert.equal(glance[0].arrival.event.id, flight.id);
  assert.equal(glance[0].tonight.id, hotel.id);
  assert.equal(glance[1].busyMinutes, 240);
  assert.ok(glance[1].load > 0.3);
  assert.equal(glance[2].needsStay, true);
  assert.equal(glance[3].needsStay, false);
  assert.equal(glance[0].missing, 1);
});

const { travelDetailsFromText, mergeTravelDetails } = loadModule("src/features/itinerary/utils/travelDetails.ts");
const { placeQuery } = loadModule("src/features/itinerary/utils/placeQuery.ts");

test("leave-by: be at the airport early plus the ride from last night's stay; boarding from the booking or ~40 min before", () => {
  const hotel = event({ type: "stay", title: "Hotel Gracery", startAt: at(18, 15), endAt: at(21, 11), place: shinjuku });
  const flight = event({ type: "transit", transitMode: "flight", title: "JL753", detail: "NRT → BLR", startAt: at(21, 18) });
  const plan = shape.travelPlan([hotel, flight], flight);
  assert.equal(plan.beThereMinutes, 120);
  assert.equal(plan.move.mode, "drive");
  assert.equal(plan.leaveAt, new Date(2026, 9, 21, 18).getTime() - (120 + plan.move.minutes) * 60_000);
  assert.equal(plan.boardingAt, new Date(2026, 9, 21, 17, 20).getTime());
  assert.equal(plan.boardingEstimated, true);
  const booked = { ...flight, travel: { boardingAt: at(21, 17, 5) } };
  assert.equal(shape.travelPlan([hotel, booked], booked).boardingAt, new Date(2026, 9, 21, 17, 5).getTime());
  const train = event({ type: "transit", transitMode: "train", title: "Shinkansen", detail: "Tokyo → Kyoto", startAt: at(20, 9) });
  const trainPlan = shape.travelPlan([hotel, train], train);
  assert.equal(trainPlan.beThereMinutes, 15);
  assert.equal(trainPlan.boardingAt, null);
});

test("gate, terminal, platform, coach, seat and boarding time are read from booking text", () => {
  const flight = travelDetailsFromText("JL754 Terminal 2 Gate: 34B Seat 32A Boarding time 10:15", "2026-10-18T10:55:00");
  assert.deepEqual(flight, { terminal: "2", gate: "34B", seat: "32A", boardingAt: "2026-10-18T10:15:00" });
  const train = travelDetailsFromText("ICE 123 Platform 7 Coach 12 Seat 45", "2026-10-18T09:00:00");
  assert.deepEqual(train, { platform: "7", coach: "12", seat: "45" });
  const lateNight = travelDetailsFromText("Boarding 11:50 PM", "2026-10-19T00:30:00");
  assert.equal(lateNight.boardingAt, "2026-10-18T23:50:00");
  assert.equal(travelDetailsFromText("Your booking is confirmed", "2026-10-18T09:00:00"), undefined);
  assert.deepEqual(mergeTravelDetails({ seat: "1A", gate: "" }, { seat: "9C", gate: "12" }), { seat: "1A", gate: "12" });
});

test("place lookups use what the user typed, else a specific title; stations for trains; nothing for flights or generic names", () => {
  assert.equal(placeQuery({ id: "a", type: "activity", title: "teamLab Planets", startAt: at(19, 9) }), "teamLab Planets");
  assert.equal(placeQuery({ id: "b", type: "activity", title: "Museum", where: "Mori Art Museum", startAt: at(19, 9) }), "Mori Art Museum");
  assert.equal(placeQuery({ id: "c", type: "stay", title: "Hotel stay", startAt: at(19, 9) }), null);
  assert.equal(placeQuery({ id: "d", type: "transit", transitMode: "train", title: "Shinkansen", detail: "Tokyo → Kyoto", startAt: at(19, 9) }), "Kyoto station");
  assert.equal(placeQuery({ id: "e", type: "transit", transitMode: "flight", title: "JL754", detail: "BLR → NRT", startAt: at(19, 9) }), null);
  assert.equal(placeQuery({ id: "f", type: "activity", title: "teamLab", place: shinjuku, startAt: at(19, 9) }), null);
});
