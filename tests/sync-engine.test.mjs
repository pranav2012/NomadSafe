import assert from "node:assert/strict";
import test from "node:test";
import { becomeActive, bundleWithFakes, instantiate, settle } from "./support/sync-harness.mjs";

const code = await bundleWithFakes(`
export { startSync, stopSync, hasBackupOwner, clearSyncedLocalData } from "./src/features/sync/services/syncEngine";
export { hashOf } from "./src/features/sync/utils/hash";
export { useTripsStore } from "./src/features/trips/store/tripsStore";
export { useExpensesStore } from "./src/features/expenses/store/expensesStore";
export { useEventsStore } from "./src/features/itinerary/store/eventsStore";
export { usePocketsStore } from "./src/features/expenses/store/pocketsStore";
`);

const SELF_ID = "__self__";
const UID = "user-1";
const CREATED = "2026-01-01T00:00:00.000Z";

const trip = (id, extra = {}) => ({
  id,
  name: "Goa",
  destinations: ["Goa"],
  startDate: "2026-01-01",
  endDate: "2026-01-05",
  mode: "solo",
  budget: 0,
  currency: "INR",
  companions: [],
  createdAt: CREATED,
  ...extra,
});
const expense = (id, extra = {}) => ({
  id,
  groupId: "t1",
  merchant: "Cafe",
  amount: 100,
  currency: "INR",
  category: "food",
  date: "2026-01-02T10:00:00.000Z",
  source: "manual",
  createdAt: CREATED,
  ...extra,
});
const sharedInfo = { groupId: "s1", myMemberId: "m1", role: "owner", inviteCode: "ABC", archived: false, muted: false, members: [] };

/** A fresh app with a fake `sync.pull` / `sync.push` backend. */
function setup({ remote = [], ledger, owner } = {}) {
  const { mod, harness } = instantiate(code);
  const server = { remote, pushes: [], pulls: [], onPush: null };
  harness.convex.query = async (path, args) => {
    assert.equal(path, "sync.pull");
    server.pulls.push(args.after);
    return { page: server.remote.filter((record) => record.serverSeq > args.after), isDone: true, continueCursor: "" };
  };
  harness.convex.mutation = async (path, args) => {
    assert.equal(path, "sync.push");
    if (server.onPush) return server.onPush(args.records);
    server.pushes.push(args.records);
    return { rejectedSeq: null };
  };
  if (ledger) harness.storage.set(`sync-ledger:${UID}`, JSON.stringify(ledger));
  if (owner) harness.storage.set("sync-owner", owner);
  const ledgerOf = (uid = UID) => JSON.parse(harness.storage.get(`sync-ledger:${uid}`) ?? "null");
  const pushed = () => server.pushes.flat();
  return { mod, harness, server, ledgerOf, pushed };
}

async function run(ctx) {
  ctx.mod.startSync(UID);
  await settle();
}

test("first sync pushes every local record and records it in the per-user ledger", async (t) => {
  const ctx = setup();
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useTripsStore.setState({ trips: [trip("t1")] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1")], settlements: [] });
  await run(ctx);

  const keys = ctx.pushed().map((record) => `${record.kind}:${record.clientId}`).sort();
  assert.deepEqual(keys, ["expense:e1", "trip:t1"]);
  assert.ok(ctx.pushed().every((record) => record.deleted === false));
  const ledger = ctx.ledgerOf();
  assert.deepEqual(Object.keys(ledger.entries).sort(), ["expense:e1", "trip:t1"]);
  assert.equal(ledger.entries["expense:e1"].hash, ctx.mod.hashOf(expense("e1")));
});

test("only records that changed since the ledger are pushed, and deletions become tombstones", async (t) => {
  const ctx = setup();
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useTripsStore.setState({ trips: [trip("t1")] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1"), expense("e2")], settlements: [] });
  await run(ctx);
  ctx.server.pushes.length = 0;

  becomeActive(ctx.harness);
  await settle();
  assert.equal(ctx.server.pushes.length, 0, "nothing changed, nothing sent");

  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1", { amount: 250 })] });
  becomeActive(ctx.harness);
  await settle();
  const sent = ctx.pushed();
  assert.equal(sent.length, 2);
  const changed = sent.find((record) => record.clientId === "e1");
  assert.equal(changed.deleted, false);
  assert.equal(changed.data.amount, 250);
  const tombstone = sent.find((record) => record.clientId === "e2");
  assert.equal(tombstone.kind, "expense");
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.data, undefined);
  assert.equal(ctx.ledgerOf().entries["expense:e2"], undefined, "a sent deletion leaves the ledger");
});

test("raw imported text and the note of email imports never leave the device", async (t) => {
  const ctx = setup();
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useExpensesStore.setState({
    expenses: [
      expense("mail", { source: "email", rawText: "full email body", note: "From: airline@example.com" }),
      expense("manual", { rawText: "pasted", note: "dinner with Sam" }),
    ],
    settlements: [],
  });
  ctx.mod.useEventsStore.setState({
    events: [{ id: "ev1", tripId: "t1", type: "flight", title: "BOM → GOI", startAt: "2026-01-01T08:00:00", source: "email", rawText: "booking email", note: "Subject: your flight" }],
  });
  await run(ctx);

  const byId = new Map(ctx.pushed().map((record) => [record.clientId, record.data]));
  assert.equal("rawText" in byId.get("mail"), false);
  assert.equal("note" in byId.get("mail"), false);
  assert.equal("rawText" in byId.get("manual"), false);
  assert.equal(byId.get("manual").note, "dinner with Sam", "a typed note is backed up");
  assert.equal("rawText" in byId.get("ev1"), false);
  assert.equal("note" in byId.get("ev1"), false);
});

test("a shared trip and the records it owns stay out of the personal backup, except your own unsplit spends", async (t) => {
  const ctx = setup();
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useTripsStore.setState({ trips: [trip("g-s1", { mode: "group", shared: sharedInfo }), trip("t1")] });
  ctx.mod.useExpensesStore.setState({
    expenses: [
      expense("split", { groupId: "g-s1", shares: [{ person: SELF_ID, amount: 50 }, { person: "Sam", amount: 50 }] }),
      expense("paid-by-sam", { groupId: "g-s1", paidBy: "Sam" }),
      expense("mine", { groupId: "g-s1" }),
    ],
    settlements: [{ id: "s1", groupId: "g-s1", from: "Sam", to: SELF_ID, amount: 50, currency: "INR", date: CREATED, source: "manual", createdAt: CREATED }],
  });
  ctx.mod.useEventsStore.setState({ events: [{ id: "ev1", tripId: "g-s1", type: "activity", title: "Beach", startAt: "2026-01-02T10:00:00", source: "manual" }] });
  await run(ctx);

  const keys = ctx.pushed().map((record) => `${record.kind}:${record.clientId}`).sort();
  assert.deepEqual(keys, ["expense:mine", "trip:t1"]);
});

test("an unsplit spend already synced with the shared trip stays with the trip", async (t) => {
  const ctx = setup();
  t.after(() => ctx.mod.stopSync());
  ctx.harness.storage.set(`group-ledger:${UID}:s1`, JSON.stringify({ entries: { "expense:mine": { hash: "h", updatedAt: 1 } } }));
  ctx.mod.useTripsStore.setState({ trips: [trip("g-s1", { mode: "group", shared: sharedInfo })] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("mine", { groupId: "g-s1" })], settlements: [] });
  await run(ctx);
  assert.deepEqual(ctx.pushed(), []);
});

test("pulled records newer than the ledger are applied, keeping local-only fields", async (t) => {
  const ctx = setup({
    remote: [
      { kind: "trip", clientId: "t1", data: trip("t1", { name: "Goa (edited)" }), deleted: false, updatedAt: 5000, serverSeq: 3 },
      { kind: "expense", clientId: "e1", data: expense("e1", { amount: 999, source: "email" }), deleted: false, updatedAt: 5000, serverSeq: 4 },
    ],
    ledger: { cursor: 2, entries: { "trip:t1": { hash: "old", updatedAt: 1000 }, "expense:e1": { hash: "old", updatedAt: 1000 } } },
  });
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useTripsStore.setState({ trips: [trip("t1")] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1", { source: "email", rawText: "email body", note: "From: shop" })], settlements: [] });
  await run(ctx);

  assert.equal(ctx.server.pulls[0], 2, "pulls after the stored cursor");
  assert.equal(ctx.mod.useTripsStore.getState().trips[0].name, "Goa (edited)");
  const local = ctx.mod.useExpensesStore.getState().expenses[0];
  assert.equal(local.amount, 999);
  assert.equal(local.rawText, "email body");
  assert.equal(local.note, "From: shop");
  const ledger = ctx.ledgerOf();
  assert.equal(ledger.cursor, 4);
  assert.equal(ledger.entries["expense:e1"].updatedAt, 5000);
  assert.equal(ctx.pushed().length, 0, "an adopted record isn't echoed back");
});

test("a pulled expense from an older build gets its tripId renamed to groupId; events keep tripId", async (t) => {
  const { groupId: _drop, ...legacy } = expense("e1");
  const ctx = setup({
    remote: [
      { kind: "expense", clientId: "e1", data: { ...legacy, tripId: "t1" }, deleted: false, updatedAt: 5000, serverSeq: 1 },
      // An older sync wrongly renamed an event's tripId too.
      { kind: "event", clientId: "ev1", data: { id: "ev1", groupId: "t1", type: "activity", title: "Beach", startAt: "2026-01-02T10:00:00", source: "manual" }, deleted: false, updatedAt: 5000, serverSeq: 2 },
    ],
  });
  t.after(() => ctx.mod.stopSync());
  await run(ctx);

  const local = ctx.mod.useExpensesStore.getState().expenses[0];
  assert.equal(local.groupId, "t1");
  assert.equal("tripId" in local, false);
  const event = ctx.mod.useEventsStore.getState().events[0];
  assert.equal(event.tripId, "t1");
  assert.equal("groupId" in event, false);
});

test("last write wins: a pulled record older than this device's write is ignored and the local one is pushed", async (t) => {
  const ctx = setup({
    remote: [{ kind: "expense", clientId: "e1", data: expense("e1", { amount: 1 }), deleted: false, updatedAt: 1000, serverSeq: 7 }],
    ledger: { cursor: 0, entries: { "expense:e1": { hash: "stale", updatedAt: 2000 } } },
  });
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1", { amount: 500 })], settlements: [] });
  await run(ctx);

  assert.equal(ctx.mod.useExpensesStore.getState().expenses[0].amount, 500);
  assert.equal(ctx.ledgerOf().cursor, 7);
  assert.deepEqual(ctx.pushed().map((record) => [record.clientId, record.data.amount]), [["e1", 500]]);
});

test("a pulled tombstone without data deletes the local record without crashing the pull", async (t) => {
  const ctx = setup({
    remote: [
      { kind: "expense", clientId: "e1", deleted: true, updatedAt: 5000, serverSeq: 3 },
      { kind: "event", clientId: "ev1", deleted: true, updatedAt: 5000, serverSeq: 4 },
      { kind: "trip", clientId: "t2", deleted: true, updatedAt: 5000, serverSeq: 5 },
      { kind: "expense", clientId: "never-seen", deleted: true, updatedAt: 5000, serverSeq: 6 },
    ],
    ledger: {
      cursor: 0,
      entries: {
        "expense:e1": { hash: "a", updatedAt: 1000 },
        "event:ev1": { hash: "b", updatedAt: 1000 },
        "trip:t2": { hash: "c", updatedAt: 1000 },
      },
    },
  });
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useTripsStore.setState({ trips: [trip("t1"), trip("t2")] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1"), expense("e2")], settlements: [] });
  ctx.mod.useEventsStore.setState({ events: [{ id: "ev1", tripId: "t1", type: "activity", title: "Beach", startAt: "2026-01-02T10:00:00", source: "manual" }] });
  await run(ctx);

  assert.deepEqual(ctx.mod.useExpensesStore.getState().expenses.map((item) => item.id), ["e2"]);
  assert.deepEqual(ctx.mod.useEventsStore.getState().events, []);
  assert.deepEqual(ctx.mod.useTripsStore.getState().trips.map((item) => item.id), ["t1"]);
  const ledger = ctx.ledgerOf();
  assert.equal(ledger.cursor, 6);
  for (const key of ["expense:e1", "event:ev1", "trip:t2", "expense:never-seen"]) assert.equal(ledger.entries[key], undefined);
  assert.ok(ctx.pushed().every((record) => !record.deleted), "pulled deletions aren't pushed back");
});

test("pulled records that now belong to a shared trip are left to the trip's sync", async (t) => {
  const ctx = setup({
    remote: [{ kind: "expense", clientId: "split", data: expense("split", { amount: 1 }), deleted: false, updatedAt: 5000, serverSeq: 2 }],
    ledger: { cursor: 0, entries: { "expense:split": { hash: "x", updatedAt: 1000 } } },
  });
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useTripsStore.setState({ trips: [trip("g-s1", { mode: "group", shared: sharedInfo })] });
  const local = expense("split", { groupId: "g-s1", amount: 80, shares: [{ person: SELF_ID, amount: 40 }, { person: "Sam", amount: 40 }] });
  ctx.mod.useExpensesStore.setState({ expenses: [local], settlements: [] });
  await run(ctx);

  assert.equal(ctx.mod.useExpensesStore.getState().expenses[0].amount, 80);
  assert.equal(ctx.ledgerOf().entries["expense:split"], undefined);
  assert.deepEqual(ctx.pushed(), [], "and the personal backup doesn't delete it either");
});

test("empty stores at startup with a non-empty ledger re-download instead of pushing deletions", async (t) => {
  const ctx = setup({
    remote: [{ kind: "expense", clientId: "e1", data: expense("e1"), deleted: false, updatedAt: 1000, serverSeq: 1 }],
    ledger: { cursor: 1, entries: { "expense:e1": { hash: "h", updatedAt: 1000 } } },
  });
  t.after(() => ctx.mod.stopSync());
  await run(ctx);

  assert.deepEqual(ctx.pushed(), []);
  assert.ok(ctx.server.pulls.includes(0), "the ledger was reset and everything pulled again");
  assert.deepEqual(ctx.mod.useExpensesStore.getState().expenses.map((item) => item.id), ["e1"]);
});

test("a push the server rejects as older rewinds the cursor and pulls again", async (t) => {
  const ctx = setup({ ledger: { cursor: 10, entries: {} } });
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1")], settlements: [] });
  let first = true;
  ctx.server.onPush = (records) => {
    ctx.server.pushes.push(records);
    if (!first) return { rejectedSeq: null };
    first = false;
    // Another phone wrote e1 later; the server keeps its copy.
    ctx.server.remote.push({ kind: "expense", clientId: "e1", data: expense("e1", { amount: 7 }), deleted: false, updatedAt: Date.now() + 60_000, serverSeq: 6 });
    return { rejectedSeq: 6 };
  };
  await run(ctx);

  assert.deepEqual(ctx.server.pulls.slice(0, 2), [10, 5]);
  assert.equal(ctx.mod.useExpensesStore.getState().expenses[0].amount, 7, "the other phone's copy is adopted");
});

test("forex pockets go in their own batch, so a server that rejects them doesn't hold back the rest", async (t) => {
  const ctx = setup();
  t.after(() => ctx.mod.stopSync());
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1")], settlements: [] });
  ctx.mod.usePocketsStore.setState({ pockets: [{ id: "p1", groupId: "t1", kind: "cash", currency: "JPY", homeCurrency: "INR", loads: [], spendIds: [], createdAt: CREATED }] });
  ctx.server.onPush = (records) => {
    if (records.some((record) => record.kind === "pocket")) throw new Error("unknown kind");
    ctx.server.pushes.push(records);
    return { rejectedSeq: null };
  };
  await run(ctx);

  assert.deepEqual(ctx.pushed().map((record) => record.kind), ["expense"]);
  const ledger = ctx.ledgerOf();
  assert.ok(ledger.entries["expense:e1"]);
  assert.equal(ledger.entries["pocket:p1"], undefined, "retried on the next sync");
});

test("signing in adopts unowned local data", async (t) => {
  const ctx = setup();
  t.after(() => ctx.mod.stopSync());
  assert.equal(ctx.mod.hasBackupOwner(), false);
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1")], settlements: [] });
  await run(ctx);

  assert.equal(ctx.harness.storage.get("sync-owner"), UID);
  assert.equal(ctx.mod.hasBackupOwner(), true);
  assert.deepEqual(ctx.pushed().map((record) => record.clientId), ["e1"]);
});

test("signing in as another account clears the previous account's data and ledgers first", async (t) => {
  const ctx = setup({ owner: "someone-else" });
  t.after(() => ctx.mod.stopSync());
  ctx.harness.storage.set("sync-ledger:someone-else", JSON.stringify({ cursor: 3, entries: { "expense:e1": { hash: "h", updatedAt: 1 } } }));
  ctx.harness.storage.set("group-ledger:someone-else:s1", "{}");
  ctx.mod.useTripsStore.setState({ trips: [trip("t1")] });
  ctx.mod.useExpensesStore.setState({ expenses: [expense("e1")], settlements: [] });
  await run(ctx);

  assert.deepEqual(ctx.mod.useExpensesStore.getState().expenses, []);
  assert.deepEqual(ctx.mod.useTripsStore.getState().trips, []);
  assert.equal(ctx.harness.storage.has("sync-ledger:someone-else"), false);
  assert.equal(ctx.harness.storage.has("group-ledger:someone-else:s1"), false);
  assert.equal(ctx.harness.storage.get("sync-owner"), UID);
  assert.deepEqual(ctx.pushed(), [], "the other account's records aren't pushed to this one");
});
