import { AppState, type NativeEventSubscription } from "react-native";
import { api, convex } from "@/modules/backend";
import { useExpensesStore, type Expense, type Settlement } from "@/features/expenses/store/expensesStore";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { usePassportStore, type PastTravel } from "@/features/passport/store/passportStore";
import { deleteAllTripPhotos } from "@/features/recap/services/tripPhotos";
import { deleteAllTickets } from "@/features/itinerary/services/tickets";
import { useTravelInfoStore } from "@/features/trips/store/travelInfoStore";
import { pickDefaultActiveTripId, useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { syncWidgets } from "@/features/widget/syncWidgets";
import { logger } from "@/modules/logger";
import { storage } from "@/modules/storage";
import { hashOf } from "../utils/hash";
import { clearGroupLedgers, keepLocalOnly, makeSharedScope, stripRaw } from "../utils/sharedScope";

type Kind = "trip" | "expense" | "settlement" | "event" | "passport";

interface LedgerEntry {
  hash: string;
  updatedAt: number;
}

// What this device last agreed with the server on, per record, plus the pull cursor.
interface Ledger {
  cursor: number;
  entries: Record<string, LedgerEntry>;
}

interface RemoteRecord {
  kind: Kind;
  clientId: string;
  data?: unknown;
  deleted: boolean;
  updatedAt: number;
  serverSeq: number;
}

const OWNER_KEY = "sync-owner";
const ledgerKey = (userId: string) => `sync-ledger:${userId}`;
const PUSH_DEBOUNCE_MS = 1500;
const PUSH_BATCH = 100;
const PULL_PAGE = 200;

function localRecords(): Map<string, { kind: Kind; id: string; data: unknown }> {
  const records = new Map<string, { kind: Kind; id: string; data: unknown }>();
  const add = (kind: Kind, id: string, data: unknown) => records.set(`${kind}:${id}`, { kind, id, data });
  // Shared trips and the records they own sync through the trip; only your own unsplit expenses on
  // a shared trip stay in the personal backup.
  const trips = useTripsStore.getState().trips;
  const scope = makeSharedScope(userId, trips);
  for (const trip of trips) if (!trip.shared) add("trip", trip.id, trip);
  const { expenses, settlements } = useExpensesStore.getState();
  for (const expense of expenses) if (!scope.has("expense", expense)) add("expense", expense.id, stripRaw(expense));
  for (const settlement of settlements) if (!scope.has("settlement", settlement)) add("settlement", settlement.id, settlement);
  for (const event of useEventsStore.getState().events) if (!scope.has("event", event)) add("event", event.id, stripRaw(event));
  for (const entry of usePassportStore.getState().entries) add("passport", entry.id, entry);
  return records;
}

/** Whether the local copy of a record (if any) currently belongs to a shared trip. */
function isLocallyShared(scope: ReturnType<typeof makeSharedScope>, kind: Exclude<Kind, "trip">, id: string) {
  if (kind === "passport") return false;
  if (kind === "event") {
    const event = useEventsStore.getState().events.find((item) => item.id === id);
    return event ? scope.has("event", event) : false;
  }
  const { expenses, settlements } = useExpensesStore.getState();
  if (kind === "settlement") {
    const settlement = settlements.find((item) => item.id === id);
    return settlement ? scope.has("settlement", settlement) : false;
  }
  const expense = expenses.find((item) => item.id === id);
  return expense ? scope.has("expense", expense) : false;
}

function readLedger(userId: string): Ledger {
  try {
    const raw = storage.getString(ledgerKey(userId));
    if (raw) return JSON.parse(raw) as Ledger;
  } catch {}
  return { cursor: 0, entries: {} };
}

function writeLedger(userId: string, ledger: Ledger) {
  storage.set(ledgerKey(userId), JSON.stringify(ledger));
}

let userId: string | null = null;
let unsubscribers: (() => void)[] = [];
let appStateSub: NativeEventSubscription | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<boolean> | null = null;
let runningUid: string | null = null;
let firstPush = true;
let rerun = false;

/** Sends every local change the ledger hasn't seen yet. Returns false if anything failed to send. */
async function pushChanges(uid: string): Promise<boolean> {
  const ledger = readLedger(uid);
  const local = localRecords();
  const now = Date.now();
  // At startup, empty stores with a non-empty ledger means local data was lost rather than deleted
  // (deleting happens in-session): re-download instead of pushing every record as a deletion.
  const suspectLoss = firstPush && local.size === 0 && Object.keys(ledger.entries).length > 0;
  firstPush = false;
  if (suspectLoss) {
    writeLedger(uid, { cursor: 0, entries: {} });
    return pullChanges(uid);
  }
  const changes: { key: string; record: { kind: Kind; clientId: string; data?: unknown; deleted: boolean; updatedAt: number }; hash: string }[] = [];

  for (const [key, { kind, id, data }] of local) {
    const hash = hashOf(data);
    if (ledger.entries[key]?.hash === hash) continue;
    changes.push({ key, hash, record: { kind, clientId: id, data, deleted: false, updatedAt: now } });
  }
  // A record the server knows about but this device no longer has was deleted here.
  for (const key of Object.keys(ledger.entries)) {
    if (local.has(key)) continue;
    const [kind, ...rest] = key.split(":");
    changes.push({ key, hash: "", record: { kind: kind as Kind, clientId: rest.join(":"), deleted: true, updatedAt: now } });
  }

  for (let i = 0; i < changes.length; i += PUSH_BATCH) {
    const batch = changes.slice(i, i + PUSH_BATCH);
    let rejectedSeq: number | null = null;
    try {
      ({ rejectedSeq } = await convex.mutation(api.sync.push, { records: batch.map((change) => change.record) }));
    } catch (err) {
      logger.warn("sync", "push failed", err, { records: batch.length });
      return false;
    }
    if (userId !== uid) return false;
    for (const change of batch) {
      if (change.record.deleted) delete ledger.entries[change.key];
      else ledger.entries[change.key] = { hash: change.hash, updatedAt: now };
    }
    // Another device wrote some of these more recently: pull them again so this phone adopts them.
    if (rejectedSeq !== null) {
      ledger.cursor = Math.min(ledger.cursor, rejectedSeq - 1);
      for (const change of batch) ledger.entries[change.key] = { hash: "", updatedAt: 0 };
      rerun = true;
    }
    writeLedger(uid, ledger);
  }
  return true;
}

/** Fetches everything written since the last pull and merges it into the local stores. */
async function pullChanges(uid: string): Promise<boolean> {
  const ledger = readLedger(uid);
  const remote: RemoteRecord[] = [];
  let cursor: string | null = null;
  try {
    for (;;) {
      const page: { page: RemoteRecord[]; isDone: boolean; continueCursor: string } = await convex.query(api.sync.pull, {
        after: ledger.cursor,
        paginationOpts: { cursor, numItems: PULL_PAGE },
      });
      remote.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  } catch (err) {
    logger.warn("sync", "pull failed", err);
    return false;
  }
  // Signed out (or switched account) while the request was in flight.
  if (userId !== uid) return false;
  if (remote.length === 0) return true;

  // Only records newer than what this device last synced, and actually different, are applied.
  const incoming = new Map<string, RemoteRecord>();
  for (const record of remote) {
    const key = `${record.kind}:${record.clientId}`;
    const entry = ledger.entries[key];
    const hash = record.deleted ? "" : hashOf(record.data);
    if (entry && (entry.updatedAt > record.updatedAt || entry.hash === hash)) continue;
    if (!entry && record.deleted) continue;
    incoming.set(key, record);
  }
  // Records that now belong to a shared trip are owned by that trip's sync; never touch them here.
  const scope = makeSharedScope(uid, useTripsStore.getState().trips);
  for (const [key, record] of incoming) {
    const local = { id: record.clientId, ...(record.data as object), tripId: (record.data as { tripId?: string | null } | undefined)?.tripId ?? null };
    const ownedByTrip =
      record.kind === "passport"
        ? false
        : record.kind === "trip"
        ? useTripsStore.getState().trips.some((trip) => trip.id === record.clientId && trip.shared)
        : isLocallyShared(scope, record.kind, record.clientId) || (!record.deleted && scope.has(record.kind, local));
    if (!ownedByTrip) continue;
    incoming.delete(key);
    delete ledger.entries[key];
  }
  if (incoming.size > 0) applyRemote(incoming);

  for (const [key, record] of incoming) {
    if (record.deleted) delete ledger.entries[key];
    else ledger.entries[key] = { hash: hashOf(record.data), updatedAt: record.updatedAt };
  }
  ledger.cursor = Math.max(ledger.cursor, ...remote.map((record) => record.serverSeq));
  writeLedger(uid, ledger);
  return true;
}

/** Merges one kind of record: upserts by id (keeping local-only fields) and drops deleted ones. */
function merge<T extends { id: string; rawText?: string; note?: string; source?: string; createdAt?: string }>(
  current: T[],
  kind: Kind,
  incoming: Map<string, RemoteRecord>,
): T[] | null {
  const records = [...incoming.values()].filter((record) => record.kind === kind);
  if (records.length === 0) return null;
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const record of records) {
    if (record.deleted) {
      byId.delete(record.clientId);
      continue;
    }
    const previous = byId.get(record.clientId);
    byId.set(record.clientId, keepLocalOnly({ ...(record.data as T) }, previous));
  }
  return [...byId.values()].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function applyRemote(incoming: Map<string, RemoteRecord>) {
  const tripsState = useTripsStore.getState();
  const trips = merge<Trip>(tripsState.trips, "trip", incoming);
  if (trips) {
    const activeStillThere = trips.some((trip) => trip.id === tripsState.activeTripId);
    useTripsStore.setState({ trips, activeTripId: activeStillThere ? tripsState.activeTripId : pickDefaultActiveTripId(trips) });
  }
  const expensesState = useExpensesStore.getState();
  const expenses = merge<Expense>(expensesState.expenses, "expense", incoming);
  const settlements = merge<Settlement>(expensesState.settlements, "settlement", incoming);
  if (expenses || settlements) {
    useExpensesStore.setState({
      expenses: expenses ?? expensesState.expenses,
      settlements: settlements ?? expensesState.settlements,
    });
  }
  const events = merge<TripEvent>(useEventsStore.getState().events, "event", incoming);
  if (events) useEventsStore.setState({ events });
  const passport = merge<PastTravel>(usePassportStore.getState().entries, "passport", incoming);
  if (passport) usePassportStore.setState({ entries: passport });
  if (trips) void syncWidgets();
}

/** Pull then push, serialised; a request while one runs schedules exactly one more. */
function syncNow(): Promise<boolean> {
  const uid = userId;
  if (!uid) return Promise.resolve(false);
  if (running && runningUid !== uid) return running.then(() => syncNow());
  if (running) {
    rerun = true;
    return running;
  }
  runningUid = uid;
  running = (async () => {
    let ok = true;
    do {
      rerun = false;
      ok = (await pullChanges(uid)) && (await pushChanges(uid));
    } while (rerun && userId === uid);
    return ok;
  })().finally(() => {
    running = null;
    runningUid = null;
  });
  return running;
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, PUSH_DEBOUNCE_MS);
}

/** True when the data on this phone is backed up to an account (and so is cleared on sign-out). */
export function hasBackupOwner() {
  return storage.getString(OWNER_KEY) !== undefined;
}

/** Clears synced data from this phone (it's kept on the account) along with this device's sync state. */
export function clearSyncedLocalData() {
  const owner = storage.getString(OWNER_KEY);
  useTripsStore.getState().reset();
  useExpensesStore.getState().reset();
  useEventsStore.getState().reset();
  usePassportStore.getState().reset();
  void deleteAllTripPhotos();
  void deleteAllTickets();
  useTravelInfoStore.getState().reset();
  if (owner) storage.remove(ledgerKey(owner));
  storage.remove(OWNER_KEY);
  clearGroupLedgers();
  void syncWidgets();
}

/** Starts backup for the signed-in user; another account's data is cleared, unowned local data is adopted. */
export function startSync(uid: string) {
  if (userId === uid) return;
  stopSync();
  const owner = storage.getString(OWNER_KEY);
  if (owner && owner !== uid) clearSyncedLocalData();
  storage.set(OWNER_KEY, uid);
  userId = uid;
  firstPush = true;
  unsubscribers = [
    useTripsStore.subscribe(schedulePush),
    useExpensesStore.subscribe(schedulePush),
    useEventsStore.subscribe(schedulePush),
    usePassportStore.subscribe(schedulePush),
  ];
  appStateSub = AppState.addEventListener("change", (next) => {
    if (next === "active") void syncNow();
  });
  void syncNow();
}

export function stopSync() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
  appStateSub?.remove();
  appStateSub = null;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  userId = null;
}

const FLUSH_TIMEOUT_MS = 8000;

/** Sends pending changes now (before sign-out). Resolves false when something couldn't be sent in time. */
export async function flushSync(): Promise<boolean> {
  if (!userId) return true;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  // Convex queues calls while offline instead of failing, so give up after a while.
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS));
  return Promise.race([syncNow(), timeout]);
}

/** Backup turned off: stop syncing, delete the server copy, and keep the data on this phone only. */
export async function disableBackup() {
  await convex.mutation(api.sync.deleteBackup, {});
  stopSync();
  const owner = storage.getString(OWNER_KEY);
  if (owner) storage.remove(ledgerKey(owner));
  storage.remove(OWNER_KEY);
}
