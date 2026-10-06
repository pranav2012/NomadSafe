import { api, convex, type Id } from "@/modules/backend";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useExpensesStore, type Expense, type Settlement } from "@/features/expenses/store/expensesStore";
import { SELF_ID, type ExpenseShare } from "@/features/expenses/utils/split";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { pickDefaultActiveTripId, useTripsStore, type SharedTripInfo, type Trip } from "@/features/trips/store/tripsStore";
import { syncWidgets } from "@/features/widget/syncWidgets";
import { logger } from "@/modules/logger";
import { storage } from "@/modules/storage";
import { hashOf } from "../utils/hash";
import { clearGroupLedgers, groupLedgerKey, keepLocalOnly, makeSharedScope, stripRaw, type SharedKind } from "../utils/sharedScope";

type LocalRecord = Expense | Settlement | TripEvent;

interface ServerTrip {
  tripId: Id<"sharedTrips">;
  seq: number;
  data: unknown;
  dataUpdatedAt: number;
  inviteCode: string;
  myMemberId: string;
  role: "owner" | "member";
  archived: boolean;
  muted: boolean;
  members: SharedTripInfo["members"];
}

interface RemoteRecord {
  kind: SharedKind;
  clientId: string;
  data?: unknown;
  deleted: boolean;
  updatedAt: number;
  seq: number;
}

// Per trip: the records cursor, the trip seq last fully pulled, and what was last agreed per record.
interface GroupLedger {
  cursor: number;
  seenSeq: number;
  detailsHash: string;
  detailsUpdatedAt: number;
  entries: Record<string, { hash: string; updatedAt: number }>;
}

const EMPTY_LEDGER: GroupLedger = { cursor: 0, seenSeq: 0, detailsHash: "", detailsUpdatedAt: 0, entries: {} };
const PUSH_DEBOUNCE_MS = 1200;
const PUSH_BATCH = 100;
const PULL_PAGE = 200;
const FLUSH_TIMEOUT_MS = 8000;
const MAX_MEMBER_NAME = 80;
const MAX_NEW_MEMBERS = 50;

/** Local id for a shared trip, the same on every member's phones. */
export function localTripId(serverTripId: string) {
  return `g-${serverTripId}`;
}

/** The trip fields everyone shares; people are members, and ids differ per phone. */
function tripDetails(trip: Trip) {
  return {
    name: trip.name,
    destinations: trip.destinations,
    destinationCoordinates: trip.destinationCoordinates,
    startDate: trip.startDate,
    endDate: trip.endDate,
    budget: trip.budget,
    currency: trip.currency,
    createdAt: trip.createdAt,
  };
}

function readLedger(uid: string, tripId: string): GroupLedger {
  try {
    const raw = storage.getString(groupLedgerKey(uid, tripId));
    if (raw) return JSON.parse(raw) as GroupLedger;
  } catch {}
  return { ...EMPTY_LEDGER, entries: {} };
}

function writeLedger(uid: string, tripId: string, ledger: GroupLedger) {
  storage.set(groupLedgerKey(uid, tripId), JSON.stringify(ledger));
}

/**
 * Person ids differ per phone: locally "you" is SELF_ID and others are names; on the server
 * everyone is a memberId. Each direction returns null for someone it doesn't know yet.
 */
function makeTranslator(info: SharedTripInfo) {
  const byName = new Map(info.members.map((member) => [member.name.trim().toLowerCase(), member.memberId]));
  const byId = new Map(info.members.map((member) => [member.memberId, member.name]));
  const toServer = (person: string): string | null =>
    person === SELF_ID ? info.myMemberId : byName.get(person.trim().toLowerCase()) ?? null;
  const toLocal = (memberId: string): string | null =>
    memberId === info.myMemberId ? SELF_ID : byId.get(memberId) ?? null;
  return { toServer, toLocal };
}

type Translate = (person: string) => string | null;

function mapShares(shares: ExpenseShare[] | undefined, map: Translate): ExpenseShare[] | undefined | null {
  if (!shares) return undefined;
  const out: ExpenseShare[] = [];
  for (const share of shares) {
    const person = map(share.person);
    if (person === null) return null;
    out.push({ ...share, person });
  }
  return out;
}

function mapPeople(people: string[] | undefined, map: Translate): string[] | undefined | null {
  if (!people) return undefined;
  const out: string[] = [];
  for (const person of people) {
    const mapped = map(person);
    if (mapped === null) return null;
    out.push(mapped);
  }
  return out;
}

/** A local record in server form (member ids, no local trip id, raw text or Gmail id), or null if someone isn't a member yet. */
function toServerRecord(kind: SharedKind, record: LocalRecord, map: Translate): unknown {
  if (kind === "event") {
    const { tripId: _trip, externalId: _external, sourceIds: _sources, ...rest } = stripRaw(record as TripEvent);
    const people = mapPeople(rest.people, map);
    const ticketHolders = mapPeople(rest.ticketHolders, map);
    return people === null || ticketHolders === null ? null : { ...rest, people, ticketHolders };
  }
  if (kind === "settlement") {
    const { tripId: _trip, ...rest } = record as Settlement;
    const from = map(rest.from);
    const to = map(rest.to);
    return from === null || to === null ? null : { ...rest, from, to };
  }
  const { tripId: _trip, externalId: _external, ...rest } = stripRaw(record as Expense);
  const paidBy = map(rest.paidBy ?? SELF_ID);
  const shares = mapShares(rest.shares, map);
  if (paidBy === null || shares === null) return null;
  return { ...rest, paidBy, shares };
}

/** The server form back in this phone's terms, or null if it mentions a member this phone doesn't know yet. */
function toLocalRecord(kind: SharedKind, data: unknown, tripId: string, map: Translate): LocalRecord | null {
  if (kind === "event") {
    const event = data as TripEvent;
    const people = mapPeople(event.people, map);
    const ticketHolders = mapPeople(event.ticketHolders, map);
    return people === null || ticketHolders === null ? null : { ...event, tripId, people, ticketHolders };
  }
  if (kind === "settlement") {
    const settlement = data as Settlement;
    const from = map(settlement.from);
    const to = map(settlement.to);
    return from === null || to === null ? null : { ...settlement, tripId, from, to };
  }
  const expense = data as Expense;
  const paidBy = expense.paidBy === undefined ? SELF_ID : map(expense.paidBy);
  const shares = mapShares(expense.shares, map);
  if (paidBy === null || shares === null) return null;
  return { ...expense, tripId, paidBy: paidBy === SELF_ID ? undefined : paidBy, shares };
}

function groupRecordsOf(owner: string, trip: Trip): { kind: SharedKind; record: LocalRecord }[] {
  const scope = makeSharedScope(owner, useTripsStore.getState().trips);
  const { expenses, settlements } = useExpensesStore.getState();
  const mine = <T extends { tripId: string | null }>(items: T[]) => items.filter((item) => item.tripId === trip.id);
  return [
    ...mine(expenses).filter((expense) => scope.has("expense", expense)).map((record) => ({ kind: "expense" as const, record })),
    ...mine(settlements).map((record) => ({ kind: "settlement" as const, record })),
    ...mine(useEventsStore.getState().events).map((record) => ({ kind: "event" as const, record })),
  ];
}

let uid: string | null = null;
let watchUnsubscribe: (() => void) | null = null;
let storeUnsubscribers: (() => void)[] = [];
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let latest: ServerTrip[] | null = null;
let running: Promise<boolean> | null = null;
let runningUid: string | null = null;
let rerun = false;
// The trip list can update before shareTrip re-keys the local trip; don't create a duplicate meanwhile.
let sharingInFlight = 0;
// Trips shared this session that the server list hasn't included yet; they mustn't be dropped as "gone".
const awaitingList = new Set<string>();
// Trips whose local data was checked against the ledger this session (see pushTrip).
const verified = new Set<string>();

/**
 * Removes a shared trip from this phone. Leaving or losing access removes everything on it; on
 * sign-out (`keepPersonal`) the user's own unsplit expenses stay and reattach when they sign back in.
 */
function dropLocalTrip(localId: string, serverTripId: string, owner: string, keepPersonal = false) {
  const scope = makeSharedScope(owner, useTripsStore.getState().trips);
  const trips = useTripsStore.getState();
  const remaining = trips.trips.filter((trip) => trip.id !== localId);
  if (keepPersonal) {
    const money = useExpensesStore.getState();
    useExpensesStore.setState({
      expenses: money.expenses.filter((expense) => expense.tripId !== localId || !scope.has("expense", expense)),
      settlements: money.settlements.filter((settlement) => settlement.tripId !== localId),
    });
  } else {
    useExpensesStore.getState().removeByTripId(localId);
    useChatStore.getState().removeConversation(localId);
  }
  useEventsStore.getState().removeByTripId(localId);
  useTripsStore.setState({
    trips: remaining,
    activeTripId: trips.activeTripId === localId ? pickDefaultActiveTripId(remaining) : trips.activeTripId,
  });
  storage.remove(groupLedgerKey(owner, serverTripId));
  verified.delete(serverTripId);
}

/** Mirrors the server's trip list into the trips store: new trips, details, members, preferences. */
function applyTripList(owner: string, list: ServerTrip[]) {
  const byServerId = new Map(list.map((trip) => [trip.tripId as string, trip]));
  for (const id of byServerId.keys()) awaitingList.delete(id);

  for (const local of useTripsStore.getState().trips) {
    if (!local.shared || byServerId.has(local.shared.tripId) || awaitingList.has(local.shared.tripId)) continue;
    dropLocalTrip(local.id, local.shared.tripId, owner);
  }
  const before = useTripsStore.getState().trips;
  let trips = [...before];

  for (const server of list) {
    const info: SharedTripInfo = {
      tripId: server.tripId,
      myMemberId: server.myMemberId,
      role: server.role,
      inviteCode: server.inviteCode,
      archived: server.archived,
      muted: server.muted,
      members: server.members,
    };
    const memberCompanions = server.members
      .filter((member) => member.memberId !== server.myMemberId && (member.linked || member.status !== "removed"))
      .map((member) => member.name);
    const details = server.data as ReturnType<typeof tripDetails>;
    const index = trips.findIndex((trip) => trip.shared?.tripId === server.tripId);

    if (index === -1) {
      if (sharingInFlight > 0) continue;
      trips = [{ ...details, id: localTripId(server.tripId), mode: "group", companions: memberCompanions, shared: info }, ...trips];
      // A fresh local copy starts from nothing, so a leftover ledger can't turn into deletions.
      writeLedger(owner, server.tripId, { ...EMPTY_LEDGER, entries: {}, detailsHash: hashOf(details), detailsUpdatedAt: server.dataUpdatedAt });
      continue;
    }
    const local = trips[index];
    // Names typed locally that aren't members yet stay until pushTrip adds them on the server.
    const known = new Set(server.members.map((member) => member.name.trim().toLowerCase()));
    const pending = local.companions.filter((name) => !known.has(name.trim().toLowerCase()));
    const ledger = readLedger(owner, server.tripId);
    const remoteNewer = server.dataUpdatedAt > ledger.detailsUpdatedAt && hashOf(details) !== hashOf(tripDetails(local));
    trips[index] = { ...local, ...(remoteNewer ? details : {}), mode: "group", companions: [...memberCompanions, ...pending], shared: info };
    if (remoteNewer) writeLedger(owner, server.tripId, { ...ledger, detailsHash: hashOf(details), detailsUpdatedAt: server.dataUpdatedAt });
  }

  if (hashOf(trips) !== hashOf(before)) {
    const activeId = useTripsStore.getState().activeTripId;
    useTripsStore.setState({
      trips,
      activeTripId: trips.some((trip) => trip.id === activeId) ? activeId : pickDefaultActiveTripId(trips),
    });
    void syncWidgets();
  }
}

/** Pulls a trip's records written since the last pull and merges them into the stores. */
async function pullTrip(owner: string, server: ServerTrip, local: Trip): Promise<boolean> {
  const ledger = readLedger(owner, server.tripId);
  const remote: RemoteRecord[] = [];
  let cursor: string | null = null;
  try {
    for (;;) {
      const page: { page: RemoteRecord[]; isDone: boolean; continueCursor: string } = await convex.query(api.groupTrips.pullRecords, {
        tripId: server.tripId,
        after: ledger.cursor,
        paginationOpts: { cursor, numItems: PULL_PAGE },
      });
      remote.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  } catch (err) {
    logger.warn("group-sync", "pull failed", err);
    return false;
  }
  const current = useTripsStore.getState().trips.find((trip) => trip.id === local.id);
  if (uid !== owner || !current?.shared) return false;

  const { toLocal } = makeTranslator(current.shared);
  const scope = makeSharedScope(owner, useTripsStore.getState().trips);
  const expenses = new Map(useExpensesStore.getState().expenses.map((item) => [item.id, item]));
  const settlements = new Map(useExpensesStore.getState().settlements.map((item) => [item.id, item]));
  const events = new Map(useEventsStore.getState().events.map((item) => [item.id, item]));
  const target = { expense: expenses, settlement: settlements, event: events } as const;
  let changed = false;
  // Records naming a member this phone hasn't heard of yet are retried once the member list catches up.
  let blockedSeq: number | null = null;

  for (const record of remote) {
    const key = `${record.kind}:${record.clientId}`;
    const entry = ledger.entries[key];
    const hash = record.deleted ? "" : hashOf(record.data);
    if (entry && (entry.updatedAt > record.updatedAt || entry.hash === hash)) continue;
    if (!entry && record.deleted) continue;
    const map = target[record.kind] as Map<string, LocalRecord>;
    const previous = map.get(record.clientId);

    if (record.deleted) {
      // Only remove what still belongs to the trip (an expense since made personal stays).
      if (previous && scope.has(record.kind, previous)) map.delete(record.clientId);
      delete ledger.entries[key];
      changed = true;
      continue;
    }
    const next = toLocalRecord(record.kind, record.data, current.id, toLocal);
    if (!next) {
      blockedSeq = Math.min(blockedSeq ?? record.seq, record.seq);
      continue;
    }
    const kept = previous as { rawText?: string; note?: string; source?: string; externalId?: string; sourceIds?: string[] } | undefined;
    keepLocalOnly(next as { rawText?: string; note?: string; source?: string }, kept);
    if (kept?.externalId !== undefined) (next as { externalId?: string }).externalId = kept.externalId;
    if (kept?.sourceIds !== undefined) (next as { sourceIds?: string[] }).sourceIds = kept.sourceIds;
    map.set(record.clientId, next);
    ledger.entries[key] = { hash, updatedAt: record.updatedAt };
    changed = true;
  }

  if (changed) {
    const newestFirst = <T extends { createdAt: string }>(items: Iterable<T>) => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    useExpensesStore.setState({ expenses: newestFirst(expenses.values()), settlements: newestFirst(settlements.values()) });
    useEventsStore.setState({ events: newestFirst(events.values()) });
  }
  const maxSeq = Math.max(ledger.cursor, ...remote.map((record) => record.seq));
  ledger.cursor = blockedSeq === null ? maxSeq : Math.min(maxSeq, blockedSeq - 1);
  if (blockedSeq === null) ledger.seenSeq = server.seq;
  writeLedger(owner, server.tripId, ledger);
  return true;
}

/** Sends a trip's local changes: details, new companions, and records the ledger hasn't seen. */
async function pushTrip(owner: string, local: Trip): Promise<boolean> {
  const info = local.shared!;
  if (!info.myMemberId) return true;
  const serverTripId = info.tripId as Id<"sharedTrips">;
  const ledger = readLedger(owner, info.tripId);
  const now = Date.now();
  const records = groupRecordsOf(owner, local);
  const stillHere = () => uid === owner && useTripsStore.getState().trips.some((trip) => trip.id === local.id && trip.shared);

  // At startup, no local records but a non-empty ledger means local data was lost rather than
  // deleted: re-download the trip instead of pushing every record as a deletion.
  if (!verified.has(info.tripId)) {
    verified.add(info.tripId);
    if (records.length === 0 && Object.keys(ledger.entries).length > 0) {
      writeLedger(owner, info.tripId, { ...EMPTY_LEDGER, entries: {}, detailsHash: ledger.detailsHash, detailsUpdatedAt: ledger.detailsUpdatedAt });
      rerun = true;
      return true;
    }
  }

  // A failed details or companions push is retried later but doesn't hold back the records.
  let detailsOk = true;
  try {
    const details = tripDetails(local);
    const detailsHash = hashOf(details);
    if (detailsHash !== ledger.detailsHash) {
      await convex.mutation(api.groupTrips.updateTripDetails, { tripId: serverTripId, data: details, dataUpdatedAt: now });
      if (!stillHere()) return false;
      ledger.detailsHash = detailsHash;
      ledger.detailsUpdatedAt = now;
      writeLedger(owner, info.tripId, ledger);
    }
  } catch (err) {
    logger.warn("group-sync", "details push failed", err);
    detailsOk = false;
  }
  try {
    const memberNames = new Set(info.members.map((member) => member.name.trim().toLowerCase()));
    // Names the server would reject (MAX_NAME in convex/groupTrips.ts) stay local-only.
    const newNames = local.companions
      .filter((name) => name.trim() && name.length <= MAX_MEMBER_NAME && !memberNames.has(name.trim().toLowerCase()))
      .slice(0, MAX_NEW_MEMBERS);
    if (newNames.length > 0) await convex.mutation(api.groupTrips.addCompanions, { tripId: serverTripId, names: newNames });
  } catch (err) {
    logger.warn("group-sync", "companions push failed", err);
    detailsOk = false;
  }

  const { toServer } = makeTranslator(info);
  const changes: { key: string; hash: string; record: { kind: SharedKind; clientId: string; data?: unknown; deleted: boolean; updatedAt: number } }[] = [];
  const present = new Set<string>();
  for (const { kind, record } of records) {
    const key = `${kind}:${record.id}`;
    present.add(key);
    // Waits for a newly typed companion to become a member before the record can reference them.
    const data = toServerRecord(kind, record, toServer);
    if (data === null) continue;
    const hash = hashOf(data);
    if (ledger.entries[key]?.hash === hash) continue;
    changes.push({ key, hash, record: { kind, clientId: record.id, data, deleted: false, updatedAt: now } });
  }
  for (const key of Object.keys(ledger.entries)) {
    if (present.has(key)) continue;
    const [kind, ...rest] = key.split(":");
    changes.push({ key, hash: "", record: { kind: kind as SharedKind, clientId: rest.join(":"), deleted: true, updatedAt: now } });
  }

  for (let i = 0; i < changes.length; i += PUSH_BATCH) {
    const batch = changes.slice(i, i + PUSH_BATCH);
    let rejectedSeq: number | null = null;
    try {
      ({ rejectedSeq } = await convex.mutation(api.groupTrips.pushRecords, { tripId: serverTripId, records: batch.map((change) => change.record) }));
    } catch (err) {
      logger.warn("group-sync", "push failed", err, { records: batch.length });
      return false;
    }
    if (!stillHere()) return false;
    for (const change of batch) {
      if (change.record.deleted) delete ledger.entries[change.key];
      else ledger.entries[change.key] = { hash: change.hash, updatedAt: now };
    }
    // Someone else wrote some of these more recently: pull them again so this phone adopts theirs.
    if (rejectedSeq !== null) {
      ledger.cursor = Math.min(ledger.cursor, rejectedSeq - 1);
      ledger.seenSeq = 0;
      for (const change of batch) ledger.entries[change.key] = { hash: "", updatedAt: 0 };
      rerun = true;
    }
    writeLedger(owner, info.tripId, ledger);
  }
  return detailsOk;
}

/** Pull whatever changed on the server, then push local changes, for every shared trip. */
function syncNow(): Promise<boolean> {
  const owner = uid;
  if (!owner || !latest) return Promise.resolve(true);
  if (running && runningUid !== owner) return running.then(() => syncNow());
  if (running) {
    rerun = true;
    return running;
  }
  runningUid = owner;
  running = (async () => {
    let ok = true;
    do {
      rerun = false;
      ok = true;
      for (const server of latest ?? []) {
        const local = useTripsStore.getState().trips.find((trip) => trip.shared?.tripId === server.tripId);
        if (!local?.shared?.myMemberId) continue;
        if (server.seq > readLedger(owner, server.tripId).seenSeq) ok = (await pullTrip(owner, server, local)) && ok;
        const fresh = useTripsStore.getState().trips.find((trip) => trip.id === local.id);
        if (fresh?.shared) ok = (await pushTrip(owner, fresh)) && ok;
      }
    } while (rerun && uid === owner);
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

/** Starts live sync of the user's shared trips: a Convex subscription to the trip list drives pulls. */
export function startGroupSync(userId: string) {
  if (uid === userId) return;
  stopGroupSync();
  uid = userId;
  const watch = convex.watchQuery(api.groupTrips.myTrips, {});
  const onList = () => {
    let list: ServerTrip[] | undefined;
    try {
      list = (watch.localQueryResult() as ServerTrip[] | null | undefined) ?? undefined;
    } catch (err) {
      logger.warn("group-sync", "trip list failed", err);
      return;
    }
    if (!list || uid !== userId) return;
    latest = list;
    applyTripList(userId, list);
    void syncNow();
  };
  watchUnsubscribe = watch.onUpdate(onList);
  // onUpdate doesn't fire for a result that's already cached.
  onList();
  storeUnsubscribers = [
    useTripsStore.subscribe(schedulePush),
    useExpensesStore.subscribe(schedulePush),
    useEventsStore.subscribe(schedulePush),
  ];
}

export function stopGroupSync() {
  watchUnsubscribe?.();
  watchUnsubscribe = null;
  storeUnsubscribers.forEach((unsubscribe) => unsubscribe());
  storeUnsubscribers = [];
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  latest = null;
  uid = null;
  verified.clear();
}

/** Sends pending shared-trip changes now; false if they couldn't be sent in time. */
export async function flushGroupSync(): Promise<boolean> {
  if (!uid) return true;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS));
  return Promise.race([syncNow(), timeout]);
}

/** Removes every shared trip from this phone (sign-out); they live on the server. */
export function clearSharedLocalData(owner: string | null) {
  for (const trip of useTripsStore.getState().trips) {
    if (trip.shared) dropLocalTrip(trip.id, trip.shared.tripId, owner ?? "", true);
  }
  clearGroupLedgers();
  awaitingList.clear();
}

/**
 * Shares a trip: creates it on the server, then re-keys it locally to the shared id so every phone
 * (including the owner's others) agrees on the trip id its expenses point to.
 */
export async function shareTrip(trip: Trip, ownerName: string): Promise<string> {
  sharingInFlight += 1;
  let tripId: Id<"sharedTrips">;
  try {
    ({ tripId } = await convex.mutation(api.groupTrips.shareTrip, {
      data: tripDetails(trip),
      dataUpdatedAt: Date.now(),
      ownerName,
      companions: trip.companions,
    }));
  } finally {
    sharingInFlight -= 1;
  }
  const newId = localTripId(tripId);
  const owner = uid;
  awaitingList.add(tripId);
  if (owner) writeLedger(owner, tripId, { ...EMPTY_LEDGER, entries: {}, detailsHash: hashOf(tripDetails(trip)), detailsUpdatedAt: Date.now() });

  const trips = useTripsStore.getState();
  useTripsStore.setState({
    trips: trips.trips.map((item) =>
      item.id === trip.id
        ? { ...item, id: newId, mode: "group", shared: { tripId, myMemberId: "", role: "owner", inviteCode: "", archived: false, muted: false, members: [] } }
        : item,
    ),
    activeTripId: trips.activeTripId === trip.id ? newId : trips.activeTripId,
  });
  const retag = <T extends { tripId: string | null }>(items: T[]) => items.map((item) => (item.tripId === trip.id ? { ...item, tripId: newId } : item));
  const money = useExpensesStore.getState();
  useExpensesStore.setState({ expenses: retag(money.expenses), settlements: retag(money.settlements) });
  useEventsStore.setState({ events: retag(useEventsStore.getState().events) });
  if (owner && latest) {
    applyTripList(owner, latest);
    void syncNow();
  }
  return newId;
}

/** True when the user's own balance on the trip is zero in every currency, so they may leave. */
export function isSettledUp(trip: Trip): boolean {
  const totals = new Map<string, number>();
  const add = (currency: string, value: number) => totals.set(currency, (totals.get(currency) ?? 0) + value);
  for (const expense of useExpensesStore.getState().expenses) {
    if (expense.tripId !== trip.id || !expense.shares?.length) continue;
    if ((expense.paidBy ?? SELF_ID) === SELF_ID) add(expense.currency, expense.amount);
    for (const share of expense.shares) if (share.person === SELF_ID) add(expense.currency, -share.amount);
  }
  for (const settlement of useExpensesStore.getState().settlements) {
    if (settlement.tripId !== trip.id) continue;
    if (settlement.from === SELF_ID) add(settlement.currency, settlement.amount);
    if (settlement.to === SELF_ID) add(settlement.currency, -settlement.amount);
  }
  return [...totals.values()].every((value) => Math.abs(value) < 0.01);
}
