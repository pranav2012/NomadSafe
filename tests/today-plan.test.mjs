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

const { toWallClock, normalizeWallClock } = loadModule("src/features/itinerary/utils/wallClock.ts");
const { entriesOnDay, tonightStay, livePlan } = loadModule("src/features/itinerary/utils/dayPlan.ts");
const { homeStage } = loadModule("src/features/home/utils/stage.ts");
const { formatCountdown } = loadModule("src/utils/units.ts");

const at = (d, h, m = 0) => toWallClock(new Date(2026, 9, d, h, m));
const ms = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
let seq = 0;
const event = (fields) => ({ id: `e${++seq}`, tripId: "kyoto", source: "manual", createdAt: "", ...fields });

const stay = event({ type: "stay", title: "Hotel Gracery", startAt: at(18, 15), endAt: at(21, 11) });
const inari = event({ type: "activity", title: "Fushimi Inari", startAt: at(19, 9), endAt: at(19, 13) });
const market = event({ type: "activity", title: "Nishiki Market", startAt: at(19, 14, 30) });
const dinner = event({ type: "activity", title: "Dinner", startAt: at(19, 19) });
const train = event({ type: "transit", title: "Shinkansen", detail: "Kyoto → Tokyo", startAt: at(21, 12), endAt: at(21, 14, 15) });
const events = [dinner, train, stay, market, inari];

test("wall-clock times keep the time the user picked and pass zone-less values through", () => {
  assert.equal(toWallClock(new Date(2026, 9, 18, 15, 5)), "2026-10-18T15:05:00");
  assert.equal(normalizeWallClock("2026-10-18T15:00:00"), "2026-10-18T15:00:00");
  assert.equal(normalizeWallClock("2026-10-18"), "2026-10-18");
  const instant = new Date(2026, 9, 18, 15, 0).toISOString();
  assert.equal(normalizeWallClock(instant), "2026-10-18T15:00:00");
});

test("a day lists its items in order, with a stay on its check-in and check-out days only", () => {
  const day19 = entriesOnDay(events, new Date(2026, 9, 19));
  assert.deepEqual(day19.map((entry) => entry.event.title), ["Fushimi Inari", "Nishiki Market", "Dinner"]);
  const day21 = entriesOnDay(events, new Date(2026, 9, 21));
  assert.deepEqual(day21.map((entry) => [entry.event.title, entry.role]), [["Hotel Gracery", "check-out"], ["Shinkansen", "single"]]);
  assert.equal(entriesOnDay(events, new Date(2026, 9, 20)).length, 0);
});

test("tonight's stay counts nights from check-in and ends on the check-out day", () => {
  assert.deepEqual(
    (({ event, night, nights }) => [event.title, night, nights])(tonightStay(events, new Date(2026, 9, 19))),
    ["Hotel Gracery", 2, 3],
  );
  assert.equal(tonightStay(events, new Date(2026, 9, 21)), null);
  assert.equal(tonightStay(events, new Date(2026, 9, 17)), null);
});

test("now is the item in progress; without an end it lasts an hour or until the next item", () => {
  const morning = livePlan(events, ms(19, 10));
  assert.equal(morning.current?.event.title, "Fushimi Inari");
  assert.equal(morning.next?.event.title, "Nishiki Market");

  assert.equal(livePlan(events, ms(19, 15)).current?.event.title, "Nishiki Market");
  const later = livePlan(events, ms(19, 16));
  assert.equal(later.current, null);
  assert.equal(later.next?.event.title, "Dinner");

  const lastDay = livePlan(events, ms(21, 13));
  assert.equal(lastDay.current?.event.title, "Shinkansen");
  assert.equal(lastDay.next, null);
});

test("stays are never the current item; their check-out is a next moment", () => {
  const night = livePlan(events, ms(20, 23));
  assert.equal(night.current, null);
  assert.deepEqual([night.next?.event.title, night.next?.role], ["Hotel Gracery", "check-out"]);
});

test("Home stage: upcoming, the day before, during and after", () => {
  const trip = { startDate: "2026-10-18", endDate: "2026-10-21" };
  assert.equal(homeStage(null, new Date(2026, 9, 1)), "none");
  assert.equal(homeStage(trip, new Date(2026, 9, 10)), "upcoming");
  assert.equal(homeStage(trip, new Date(2026, 9, 17, 22)), "eve");
  assert.equal(homeStage(trip, new Date(2026, 9, 18, 1)), "active");
  assert.equal(homeStage(trip, new Date(2026, 9, 21, 23)), "active");
  assert.equal(homeStage(trip, new Date(2026, 9, 22)), "ended");
});

test("countdowns are exact to the minute, rounded up", () => {
  const label = (unit, value) => `${value} ${unit}`;
  assert.equal(formatCountdown(80, "en", label), "1 h 20 min");
  assert.equal(formatCountdown(44.2, "en", label), "45 min");
  assert.equal(formatCountdown(120, "en", label), "2 h");
  assert.equal(formatCountdown(0, "en", label), "1 min");
});
