import assert from "node:assert/strict";
import test from "node:test";
import { bundleWithFakes, instantiate, settle } from "./support/sync-harness.mjs";

const code = await bundleWithFakes(`
export { startGroupSync, stopGroupSync, clearSharedLocalData, localGroupId, isSettledUp } from "./src/features/sync/services/groupSync";
export { groupDetails } from "./src/features/sync/utils/groupDetails";
export { useTripsStore } from "./src/features/trips/store/tripsStore";
export { useExpensesStore } from "./src/features/expenses/store/expensesStore";
export { useEventsStore } from "./src/features/itinerary/store/eventsStore";
`);

const SELF_ID = "__self__";
const UID = "user-1";
const CREATED = "2026-01-01T00:00:00.000Z";

const member = (memberId, name, extra = {}) => ({ memberId, name, role: "member", status: "active", linked: true, ...extra });
const MEMBERS = [member("m1", "Me", { role: "owner" }), member("m2", "Sam")];
const tripDetails = { name: "Goa", destinations: ["Goa"], startDate: "2026-01-01", endDate: "2026-01-05", budget: 0, currency: "INR", createdAt: CREATED };

const serverGroup = (groupId, data, extra = {}) => ({
  groupId,
  seq: 0,
  data,
  dataUpdatedAt: 1000,
  inviteCode: "ABC",
  myMemberId: "m1",
  role: "owner",
  archived: false,
  muted: false,
  members: MEMBERS,
  ...extra,
});
const sharedOf = (server) => ({
  groupId: server.groupId,
  myMemberId: server.myMemberId,
  role: server.role,
  inviteCode: server.inviteCode,
  archived: server.archived,
  muted: server.muted,
  members: server.members,
});
const localTrip = (server, extra = {}) => ({ ...tripDetails, id: `g-${server.groupId}`, mode: "group", companions: ["Sam"], shared: sharedOf(server), ...extra });
const expense = (id, extra = {}) => ({
  id,
  groupId: "g-s1",
  merchant: "Cafe",
  amount: 100,
  currency: "INR",
  category: "food",
  date: "2026-01-02T10:00:00.000Z",
  source: "manual",
  createdAt: CREATED,
  ...extra,
});
const event = (id, extra = {}) => ({ id, tripId: "g-s1", type: "activity", title: "Beach", startAt: "2026-01-02T10:00:00", source: "manual", ...extra });

/** A fresh app whose backend serves `list` as the user's shared groups and `records` per group. */
function setup({ list = [], records = {}, ledgers = {} } = {}) {
  const { mod, harness } = instantiate(code);
  const server = { list, records, pushes: [], mutations: [], pulls: [] };
  harness.convex.watchQuery = (path) => {
    assert.equal(path, "groups.myGroups");
    return { localQueryResult: () => server.list, onUpdate: () => () => {} };
  };
  harness.convex.query = async (path, args) => {
    assert.equal(path, "groups.pullRecords");
    server.pulls.push({ groupId: args.groupId, after: args.after });
    const page = (server.records[args.groupId] ?? []).filter((record) => record.seq > args.after);
    return { page, isDone: true, continueCursor: "" };
  };
  harness.convex.mutation = async (path, args) => {
    server.mutations.push({ path, args });
    if (path === "groups.pushRecords") {
      server.pushes.push(...args.records);
      return { rejectedSeq: null };
    }
    return {};
  };
  for (const [groupId, ledger] of Object.entries(ledgers)) harness.storage.set(`group-ledger:${UID}:${groupId}`, JSON.stringify(ledger));
  const ledgerOf = (groupId) => JSON.parse(harness.storage.get(`group-ledger:${UID}:${groupId}`) ?? "null");
  return { mod, harness, server, ledgerOf };
}

async function run(ctx) {
  ctx.mod.startGroupSync(UID);
  await settle();
}

test("server groups are mirrored into the trips store under g-<serverId>, as a trip, group or planned trip", async (t) => {
  const members = [...MEMBERS, member("m3", "Gone", { status: "removed", linked: false }), member("m4", "Lee", { status: "removed" })];
  const ctx = setup({
    list: [
      serverGroup("s1", tripDetails, { members }),
      serverGroup("s2", { kind: "group", name: "Flat", emoji: "🏠", budget: 0, currency: "INR", createdAt: CREATED }, { role: "member", myMemberId: "m2", members }),
      serverGroup("s3", { kind: "planned", name: "Bali", destinations: ["Bali"], month: "2027-03", createdAt: CREATED }, { members }),
    ],
  });
  t.after(() => ctx.mod.stopGroupSync());
  await run(ctx);

  assert.equal(ctx.mod.localGroupId("s1"), "g-s1");
  const state = ctx.mod.useTripsStore.getState();
  const trip = state.trips.find((item) => item.id === "g-s1");
  assert.equal(trip.kind, undefined);
  assert.equal(trip.mode, "group");
  assert.equal(trip.shared.groupId, "s1");
  assert.equal(trip.shared.role, "owner");
  // You aren't your own companion; a removed member stays only if they had joined.
  assert.deepEqual(trip.companions, ["Sam", "Lee"]);

  const group = state.groups.find((item) => item.id === "g-s2");
  assert.equal(group.kind, "group");
  assert.equal(group.emoji, "🏠");
  assert.equal(group.mode, undefined);
  assert.deepEqual(group.companions, ["Me", "Lee"]);

  const planned = state.plannedTrips.find((item) => item.id === "g-s3");
  assert.equal(planned.kind, "planned");
  assert.equal(planned.month, "2027-03");
  assert.equal(state.trips.some((item) => item.id === "g-s3"), false, "a planned trip never shows up as a trip");

  // A fresh copy's ledger starts from the server's details, so nothing is pushed back.
  assert.equal(ctx.ledgerOf("s1").detailsUpdatedAt, 1000);
  assert.deepEqual(ctx.server.mutations.filter((call) => call.path === "groups.updateGroupDetails"), []);
});

test("pulled records are translated from member ids to SELF_ID and names, on the local trip id", async (t) => {
  const ctx = setup({
    list: [serverGroup("s1", tripDetails, { seq: 5 })],
    records: {
      s1: [
        {
          kind: "expense",
          clientId: "e1",
          seq: 1,
          updatedAt: 1000,
          deleted: false,
          data: {
            id: "e1", merchant: "Dinner", amount: 100, currency: "INR", category: "food", date: CREATED, source: "manual", createdAt: CREATED,
            paidBy: "m2",
            shares: [{ person: "m1", amount: 60 }, { person: "m2", amount: 40 }],
            split: { mode: "percent", percents: { m1: 60, m2: 40 } },
          },
        },
        {
          kind: "expense",
          clientId: "e2",
          seq: 2,
          updatedAt: 1000,
          deleted: false,
          data: { id: "e2", merchant: "Taxi", amount: 30, currency: "INR", category: "transport", date: CREATED, source: "manual", createdAt: CREATED, paidBy: "m1", shares: [{ person: "m2", amount: 30 }] },
        },
        { kind: "settlement", clientId: "st1", seq: 3, updatedAt: 1000, deleted: false, data: { id: "st1", from: "m2", to: "m1", amount: 40, currency: "INR", date: CREATED, source: "manual", createdAt: CREATED } },
        { kind: "event", clientId: "ev1", seq: 4, updatedAt: 1000, deleted: false, data: { id: "ev1", type: "activity", title: "Beach", startAt: "2026-01-02T10:00:00", source: "manual", people: ["m1", "m2"], savedBy: "m2" } },
      ],
    },
  });
  t.after(() => ctx.mod.stopGroupSync());
  await run(ctx);

  const expenses = new Map(ctx.mod.useExpensesStore.getState().expenses.map((item) => [item.id, item]));
  const dinner = expenses.get("e1");
  assert.equal(dinner.groupId, "g-s1");
  assert.equal(dinner.paidBy, "Sam");
  assert.deepEqual(dinner.shares, [{ person: SELF_ID, amount: 60 }, { person: "Sam", amount: 40 }]);
  assert.deepEqual(dinner.split.percents, { [SELF_ID]: 60, Sam: 40 });
  assert.equal(expenses.get("e2").paidBy, undefined, "paid by you is stored as unset");

  const [settlement] = ctx.mod.useExpensesStore.getState().settlements;
  assert.deepEqual([settlement.groupId, settlement.from, settlement.to], ["g-s1", "Sam", SELF_ID]);
  const [ev] = ctx.mod.useEventsStore.getState().events;
  assert.equal(ev.tripId, "g-s1");
  assert.deepEqual(ev.people, [SELF_ID, "Sam"]);
  assert.equal(ev.savedBy, "Sam");

  const ledger = ctx.ledgerOf("s1");
  assert.equal(ledger.cursor, 4);
  assert.equal(ledger.seenSeq, 5);
  assert.deepEqual(ctx.server.pushes, [], "pulled records aren't echoed back");
});

test("a pulled record naming a member this phone doesn't know yet is held back and retried", async (t) => {
  const ctx = setup({
    list: [serverGroup("s1", tripDetails, { seq: 9 })],
    records: {
      s1: [
        { kind: "settlement", clientId: "st1", seq: 3, updatedAt: 1000, deleted: false, data: { id: "st1", from: "m9", to: "m1", amount: 5, currency: "INR", date: CREATED, source: "manual", createdAt: CREATED } },
        { kind: "expense", clientId: "e1", seq: 4, updatedAt: 1000, deleted: false, data: { ...expense("e1"), groupId: undefined, paidBy: "m1" } },
      ],
    },
  });
  t.after(() => ctx.mod.stopGroupSync());
  await run(ctx);

  assert.deepEqual(ctx.mod.useExpensesStore.getState().settlements, []);
  assert.deepEqual(ctx.mod.useExpensesStore.getState().expenses.map((item) => item.id), ["e1"]);
  const ledger = ctx.ledgerOf("s1");
  assert.equal(ledger.cursor, 2, "the cursor stops before the blocked record");
  assert.equal(ledger.seenSeq, 0, "the trip is pulled again next time");
});

test("pushed records use member ids and drop local-only fields; unsplit spends you paid stay out", async (t) => {
  const server = serverGroup("s1", tripDetails);
  const ctx = setup({ list: [server] });
  t.after(() => ctx.mod.stopGroupSync());
  ctx.mod.useTripsStore.setState({ trips: [localTrip(server, { companions: ["Sam", "Newbie"] }), { ...localTrip(server), id: "t-personal", shared: undefined, mode: "solo" }] });
  ctx.mod.useExpensesStore.setState({
    expenses: [
      expense("split", { source: "email", rawText: "receipt", note: "From: shop", externalId: "gmail:1", shares: [{ person: SELF_ID, amount: 50 }, { person: "Sam", amount: 50 }] }),
      expense("sam-paid", { paidBy: "Sam" }),
      expense("mine"),
      expense("waits-for-newbie", { shares: [{ person: SELF_ID, amount: 50 }, { person: "Newbie", amount: 50 }] }),
      expense("other-trip", { groupId: "t-personal", shares: [{ person: SELF_ID, amount: 50 }, { person: "Sam", amount: 50 }] }),
    ],
    settlements: [{ id: "st1", groupId: "g-s1", from: "Sam", to: SELF_ID, amount: 50, currency: "INR", date: CREATED, source: "manual", createdAt: CREATED }],
  });
  ctx.mod.useEventsStore.setState({ events: [event("ev1", { people: [SELF_ID], rawText: "booking", externalId: "gmail:2", sourceIds: ["gmail:3"] })] });
  await run(ctx);

  const sent = new Map(ctx.server.pushes.map((record) => [`${record.kind}:${record.clientId}`, record]));
  assert.deepEqual([...sent.keys()].sort(), ["event:ev1", "expense:sam-paid", "expense:split", "settlement:st1"]);

  const split = sent.get("expense:split").data;
  assert.equal(split.paidBy, "m1");
  assert.deepEqual(split.shares, [{ person: "m1", amount: 50 }, { person: "m2", amount: 50 }]);
  for (const field of ["groupId", "externalId", "rawText", "note"]) assert.equal(field in split, false, field);
  assert.equal(sent.get("expense:sam-paid").data.paidBy, "m2");
  const settlement = sent.get("settlement:st1").data;
  assert.deepEqual([settlement.from, settlement.to, "groupId" in settlement], ["m2", "m1", false]);
  const ev = sent.get("event:ev1").data;
  assert.deepEqual(ev.people, ["m1"]);
  for (const field of ["tripId", "rawText", "externalId", "sourceIds"]) assert.equal(field in ev, false, field);

  const added = ctx.server.mutations.find((call) => call.path === "groups.addCompanions");
  assert.deepEqual(added.args, { groupId: "s1", names: ["Newbie"] });
  assert.deepEqual(ctx.mod.useTripsStore.getState().trips.find((item) => item.id === "g-s1").companions, ["Sam", "Newbie"], "a typed name stays until it's a member");
});

test("records gone from the phone are pushed as tombstones", async (t) => {
  const server = serverGroup("s1", tripDetails);
  const ctx = setup({ list: [server], ledgers: { s1: { cursor: 0, seenSeq: 0, detailsHash: "", detailsUpdatedAt: 0, entries: { "expense:gone": { hash: "h", updatedAt: 1 } } } } });
  t.after(() => ctx.mod.stopGroupSync());
  ctx.mod.useTripsStore.setState({ trips: [localTrip(server)] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("kept", { paidBy: "Sam" })], settlements: [] });
  await run(ctx);

  const tombstone = ctx.server.pushes.find((record) => record.clientId === "gone");
  assert.deepEqual([tombstone.kind, tombstone.deleted, tombstone.data], ["expense", true, undefined]);
  assert.equal(ctx.ledgerOf("s1").entries["expense:gone"], undefined);
});

test("pulled tombstones remove trip records, and older writes than this phone's are ignored", async (t) => {
  const server = serverGroup("s1", tripDetails, { seq: 3 });
  const ctx = setup({
    list: [server],
    ledgers: { s1: { cursor: 0, seenSeq: 0, detailsHash: "", detailsUpdatedAt: 0, entries: { "expense:x1": { hash: "a", updatedAt: 100 }, "expense:x2": { hash: "b", updatedAt: 9000 } } } },
    records: {
      s1: [
        { kind: "expense", clientId: "x1", seq: 1, updatedAt: 500, deleted: true },
        { kind: "expense", clientId: "x2", seq: 2, updatedAt: 500, deleted: false, data: { ...expense("x2", { amount: 1 }), groupId: undefined, paidBy: "m2" } },
      ],
    },
  });
  t.after(() => ctx.mod.stopGroupSync());
  ctx.mod.useTripsStore.setState({ trips: [localTrip(server)] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("x1", { paidBy: "Sam" }), expense("x2", { paidBy: "Sam", amount: 77 })], settlements: [] });
  await run(ctx);

  const expenses = ctx.mod.useExpensesStore.getState().expenses;
  assert.deepEqual(expenses.map((item) => [item.id, item.amount]), [["x2", 77]]);
  assert.equal(ctx.ledgerOf("s1").entries["expense:x1"], undefined);
});

test("a trip missing from the server list (left or removed) is dropped with everything on it", async (t) => {
  const gone = serverGroup("s9", tripDetails);
  const ctx = setup({ list: [], ledgers: { s9: { cursor: 4, seenSeq: 4, detailsHash: "", detailsUpdatedAt: 0, entries: {} } } });
  t.after(() => ctx.mod.stopGroupSync());
  ctx.mod.useTripsStore.setState({ trips: [localTrip(gone), { ...localTrip(gone), id: "t1", shared: undefined, mode: "solo" }] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("a", { groupId: "g-s9" }), expense("b", { groupId: "t1" })], settlements: [] });
  ctx.mod.useEventsStore.setState({ events: [event("ev1", { tripId: "g-s9" })] });
  await run(ctx);

  assert.deepEqual(ctx.mod.useTripsStore.getState().trips.map((item) => item.id), ["t1"]);
  assert.deepEqual(ctx.mod.useExpensesStore.getState().expenses.map((item) => item.id), ["b"]);
  assert.deepEqual(ctx.mod.useEventsStore.getState().events, []);
  assert.deepEqual(ctx.harness.removedChats, ["g-s9"]);
  assert.equal(ctx.harness.storage.has(`group-ledger:${UID}:s9`), false);
});

test("newer details from the server replace the local ones", async (t) => {
  const server = serverGroup("s1", { ...tripDetails, name: "Goa & Gokarna" }, { dataUpdatedAt: 5000 });
  const ctx = setup({ list: [server], ledgers: { s1: { cursor: 0, seenSeq: 0, detailsHash: "x", detailsUpdatedAt: 1000, entries: {} } } });
  t.after(() => ctx.mod.stopGroupSync());
  ctx.mod.useTripsStore.setState({ trips: [localTrip(server, { name: "Goa" })] });
  await run(ctx);

  assert.equal(ctx.mod.useTripsStore.getState().trips[0].name, "Goa & Gokarna");
  assert.equal(ctx.ledgerOf("s1").detailsUpdatedAt, 5000);
  assert.deepEqual(ctx.server.mutations.filter((call) => call.path === "groups.updateGroupDetails"), []);
});

test("signing out removes shared trips but keeps your own unsplit spends on them", async (t) => {
  const server = serverGroup("s1", tripDetails);
  const ctx = setup();
  ctx.mod.useTripsStore.setState({ trips: [localTrip(server)] });
  ctx.mod.useExpensesStore.setState({
    expenses: [expense("mine"), expense("split", { shares: [{ person: SELF_ID, amount: 50 }, { person: "Sam", amount: 50 }] })],
    settlements: [{ id: "st1", groupId: "g-s1", from: "Sam", to: SELF_ID, amount: 50, currency: "INR", date: CREATED, source: "manual", createdAt: CREATED }],
  });
  ctx.harness.storage.set(`group-ledger:${UID}:s1`, "{}");
  t.after(() => ctx.mod.stopGroupSync());
  ctx.mod.clearSharedLocalData(UID);

  assert.deepEqual(ctx.mod.useTripsStore.getState().trips, []);
  assert.deepEqual(ctx.mod.useExpensesStore.getState().expenses.map((item) => item.id), ["mine"]);
  assert.deepEqual(ctx.mod.useExpensesStore.getState().settlements, []);
  assert.equal(ctx.harness.storage.has(`group-ledger:${UID}:s1`), false);
});

test("you're settled up only when your balance is zero in every currency", () => {
  const { mod } = instantiate(code);
  const split = (id, paidBy, currency) => expense(id, { paidBy, currency, shares: [{ person: SELF_ID, amount: 50 }, { person: "Sam", amount: 50 }] });
  mod.useExpensesStore.setState({ expenses: [split("a", undefined, "INR")], settlements: [] });
  assert.equal(mod.isSettledUp({ id: "g-s1" }), false);
  mod.useExpensesStore.setState({
    settlements: [{ id: "st1", groupId: "g-s1", from: "Sam", to: SELF_ID, amount: 50, currency: "INR", date: CREATED, source: "manual", createdAt: CREATED }],
  });
  assert.equal(mod.isSettledUp({ id: "g-s1" }), true);
  mod.useExpensesStore.setState({ expenses: [split("a", undefined, "INR"), split("b", "Sam", "USD")] });
  assert.equal(mod.isSettledUp({ id: "g-s1" }), false);
});
