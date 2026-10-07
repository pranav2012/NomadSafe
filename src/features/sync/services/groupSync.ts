import { api, convex, type Id } from "@/modules/backend";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useExpensesStore, type Expense, type Settlement } from "@/features/expenses/store/expensesStore";
import { payersOf, SELF_ID, type ExpenseShare, type ExpenseSplit } from "@/features/expenses/utils/split";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import {
  isPlanned,
  isTrip,
  selectShareables,
  setShareables,
  useTripsStore,
  type GroupBase,
  type MoneyGroup,
  type Shareable,
  type SharedGroupInfo,
} from "@/features/trips/store/tripsStore";
import { syncWidgets } from "@/features/widget/syncWidgets";
import { logger } from "@/modules/logger";
import { storage } from "@/modules/storage";
import { groupDetails, mergeDetails } from "../utils/groupDetails";
import { hashOf } from "../utils/hash";
import { clearGroupLedgers, groupLedgerKey, keepLocalOnly, makeSharedScope, stripRaw, type SharedKind } from "../utils/sharedScope";

type LocalRecord = Expense | Settlement | TripEvent;

interface ServerGroup {
  groupId: Id<"sharedGroups">;
  seq: number;
  data: unknown;
  dataUpdatedAt: number;
  inviteCode: string;
  myMemberId: string;
  role: "owner" | "member";
  archived: boolean;
  muted: boolean;
  members: SharedGroupInfo["members"];
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
export function localGroupId(serverGroupId: string) {
  return `g-${serverGroupId}`;
}

/** All trips, groups and planned trips on this phone. */
const allGroups = () => selectShareables(useTripsStore.getState());

function readLedger(uid: string, groupId: string): GroupLedger {
  try {
    const raw = storage.getString(groupLedgerKey(uid, groupId));
    if (raw) return JSON.parse(raw) as GroupLedger;
  } catch {}
  return { ...EMPTY_LEDGER, entries: {} };
}

function writeLedger(uid: string, groupId: string, ledger: GroupLedger) {
  storage.set(groupLedgerKey(uid, groupId), JSON.stringify(ledger));
}

/**
 * Person ids differ per phone: locally "you" is SELF_ID and others are names; on the server
 * everyone is a memberId. Each direction returns null for someone it doesn't know yet.
 */
function makeTranslator(info: SharedGroupInfo) {
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

function mapKeys(values: Record<string, number> | undefined, map: Translate): Record<string, number> | undefined | null {
  if (!values) return undefined;
  const out: Record<string, number> = {};
  for (const [person, value] of Object.entries(values)) {
    const mapped = map(person);
    if (mapped === null) return null;
    out[mapped] = value;
  }
  return out;
}

function mapSplit(split: ExpenseSplit | undefined, map: Translate): ExpenseSplit | undefined | null {
  if (!split) return split;
  const percents = mapKeys(split.percents, map);
  const units = mapKeys(split.units, map);
  if (percents === null || units === null) return null;
  return { ...split, ...(percents ? { percents } : {}), ...(units ? { units } : {}) };
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

/** Who saved an idea is only a label, so an unknown member drops it rather than holding the record back. */
function withSaver<T extends { savedBy?: string }>(record: T, map: Translate): T {
  if (record.savedBy === undefined) return record;
  const { savedBy, ...rest } = record;
  const mapped = map(savedBy);
  return (mapped === null ? rest : { ...rest, savedBy: mapped }) as T;
}

/** A local record in server form (member ids, no local trip id, raw text or Gmail id), or null if someone isn't a member yet. */
function toServerRecord(kind: SharedKind, record: LocalRecord, map: Translate): unknown {
  if (kind === "event") {
    const { tripId: _trip, externalId: _external, sourceIds: _sources, ...rest } = stripRaw(record as TripEvent);
    const people = mapPeople(rest.people, map);
    const ticketHolders = mapPeople(rest.ticketHolders, map);
    return people === null || ticketHolders === null ? null : withSaver({ ...rest, people, ticketHolders }, map);
  }
  if (kind === "settlement") {
    const { groupId: _group, ...rest } = record as Settlement;
    const from = map(rest.from);
    const to = map(rest.to);
    return from === null || to === null ? null : { ...rest, from, to };
  }
  const { groupId: _group, externalId: _external, ...rest } = stripRaw(record as Expense);
  const paidBy = map(rest.paidBy ?? SELF_ID);
  const shares = mapShares(rest.shares, map);
  const payers = mapShares(rest.payers, map);
  const split = mapSplit(rest.split, map);
  if (paidBy === null || shares === null || payers === null || split === null) return null;
  return { ...rest, paidBy, shares, payers, split };
}

/** The server form back in this phone's terms, or null if it mentions a member this phone doesn't know yet. */
function toLocalRecord(kind: SharedKind, data: unknown, localId: string, map: Translate): LocalRecord | null {
  if (kind === "event") {
    const event = data as TripEvent;
    const people = mapPeople(event.people, map);
    const ticketHolders = mapPeople(event.ticketHolders, map);
    return people === null || ticketHolders === null ? null : withSaver({ ...event, tripId: localId, people, ticketHolders }, map);
  }
  if (kind === "settlement") {
    const settlement = data as Settlement;
    const from = map(settlement.from);
    const to = map(settlement.to);
    return from === null || to === null ? null : { ...settlement, groupId: localId, from, to };
  }
  const expense = data as Expense;
  const paidBy = expense.paidBy === undefined ? SELF_ID : map(expense.paidBy);
  const shares = mapShares(expense.shares, map);
  const payers = mapShares(expense.payers, map);
  const split = mapSplit(expense.split, map);
  if (paidBy === null || shares === null || payers === null || split === null) return null;
  return { ...expense, groupId: localId, paidBy: paidBy === SELF_ID ? undefined : paidBy, shares, payers, split };
}

function groupRecordsOf(owner: string, trip: Pick<GroupBase, "id">): { kind: SharedKind; record: LocalRecord }[] {
  const scope = makeSharedScope(owner, allGroups());
  const { expenses, settlements } = useExpensesStore.getState();
  return [
    ...expenses.filter((item) => item.groupId === trip.id && scope.has("expense", item)).map((record) => ({ kind: "expense" as const, record })),
    ...settlements.filter((item) => item.groupId === trip.id).map((record) => ({ kind: "settlement" as const, record })),
    ...useEventsStore.getState().events.filter((item) => item.tripId === trip.id).map((record) => ({ kind: "event" as const, record })),
  ];
}

let uid: string | null = null;
let watchUnsubscribe: (() => void) | null = null;
let storeUnsubscribers: (() => void)[] = [];
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let latest: ServerGroup[] | null = null;
let running: Promise<boolean> | null = null;
let runningUid: string | null = null;
let rerun = false;
// The trip list can update before shareGroup re-keys the local trip; don't create a duplicate meanwhile.
let sharingInFlight = 0;
// Trips shared this session that the server list hasn't included yet; they mustn't be dropped as "gone".
const awaitingList = new Set<string>();
// Trips whose local data was checked against the ledger this session (see pushGroup).
const verified = new Set<string>();

/**
 * Removes a shared trip from this phone. Leaving or losing access removes everything on it; on
 * sign-out (`keepPersonal`) the user's own unsplit expenses stay and reattach when they sign back in.
 */
function dropLocalGroup(localId: string, serverGroupId: string, owner: string, keepPersonal = false) {
  const scope = makeSharedScope(owner, allGroups());
  const remaining = allGroups().filter((trip) => trip.id !== localId);
  if (keepPersonal) {
    const money = useExpensesStore.getState();
    useExpensesStore.setState({
      expenses: money.expenses.filter((expense) => expense.groupId !== localId || !scope.has("expense", expense)),
      settlements: money.settlements.filter((settlement) => settlement.groupId !== localId),
    });
  } else {
    useExpensesStore.getState().removeByGroupId(localId);
    useChatStore.getState().removeConversation(localId);
  }
  useEventsStore.getState().removeByTripId(localId);
  setShareables(remaining);
  storage.remove(groupLedgerKey(owner, serverGroupId));
  verified.delete(serverGroupId);
}

/** Mirrors the server's trip list into the trips store (trips and groups): new ones, details, members, preferences. */
function applyGroupList(owner: string, list: ServerGroup[]) {
  const byServerId = new Map(list.map((trip) => [trip.groupId as string, trip]));
  for (const id of byServerId.keys()) awaitingList.delete(id);

  for (const local of allGroups()) {
    if (!local.shared || byServerId.has(local.shared.groupId) || awaitingList.has(local.shared.groupId)) continue;
    dropLocalGroup(local.id, local.shared.groupId, owner);
  }
  const before = allGroups();
  let trips: Shareable[] = [...before];

  for (const server of list) {
    const info: SharedGroupInfo = {
      groupId: server.groupId,
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
    const details = server.data as ReturnType<typeof groupDetails>;
    const index = trips.findIndex((trip) => trip.shared?.groupId === server.groupId);

    if (index === -1) {
      if (sharingInFlight > 0) continue;
      const base = { id: localGroupId(server.groupId), companions: memberCompanions, shared: info };
      const created: Shareable =
        details.kind === "group" || details.kind === "planned" ? { ...details, ...base } : { ...details, ...base, mode: "group" };
      trips = [created, ...trips];
      // A fresh local copy starts from nothing, so a leftover ledger can't turn into deletions.
      writeLedger(owner, server.groupId, { ...EMPTY_LEDGER, entries: {}, detailsHash: hashOf(details), detailsUpdatedAt: server.dataUpdatedAt });
      continue;
    }
    const local = trips[index];
    // Names typed locally that aren't members yet stay until pushGroup adds them on the server.
    const known = new Set(server.members.map((member) => member.name.trim().toLowerCase()));
    const pending = local.companions.filter((name) => !known.has(name.trim().toLowerCase()));
    const ledger = readLedger(owner, server.groupId);
    const remoteNewer = server.dataUpdatedAt > ledger.detailsUpdatedAt && hashOf(details) !== hashOf(groupDetails(local));
    trips[index] = mergeDetails(local, remoteNewer ? details : null, [...memberCompanions, ...pending], info);
    if (remoteNewer) writeLedger(owner, server.groupId, { ...ledger, detailsHash: hashOf(details), detailsUpdatedAt: server.dataUpdatedAt });
  }

  if (hashOf(trips) !== hashOf(before)) {
    setShareables(trips);
    void syncWidgets();
  }
}

/** Pulls a trip's records written since the last pull and merges them into the stores. */
async function pullGroup(owner: string, server: ServerGroup, local: Shareable): Promise<boolean> {
  const ledger = readLedger(owner, server.groupId);
  const remote: RemoteRecord[] = [];
  let cursor: string | null = null;
  try {
    for (;;) {
      const page: { page: RemoteRecord[]; isDone: boolean; continueCursor: string } = await convex.query(api.groups.pullRecords, {
        groupId: server.groupId,
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
  const current = allGroups().find((trip) => trip.id === local.id);
  if (uid !== owner || !current?.shared) return false;

  const { toLocal } = makeTranslator(current.shared);
  const scope = makeSharedScope(owner, allGroups());
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
  writeLedger(owner, server.groupId, ledger);
  return true;
}

/** Sends a trip's local changes: details, new companions, and records the ledger hasn't seen. */
async function pushGroup(owner: string, local: Shareable): Promise<boolean> {
  const info = local.shared!;
  if (!info.myMemberId) return true;
  const serverGroupId = info.groupId as Id<"sharedGroups">;
  const ledger = readLedger(owner, info.groupId);
  const now = Date.now();
  const records = groupRecordsOf(owner, local);
  const stillHere = () => uid === owner && allGroups().some((trip) => trip.id === local.id && trip.shared);

  // At startup, no local records but a non-empty ledger means local data was lost rather than
  // deleted: re-download the trip instead of pushing every record as a deletion.
  if (!verified.has(info.groupId)) {
    verified.add(info.groupId);
    if (records.length === 0 && Object.keys(ledger.entries).length > 0) {
      writeLedger(owner, info.groupId, { ...EMPTY_LEDGER, entries: {}, detailsHash: ledger.detailsHash, detailsUpdatedAt: ledger.detailsUpdatedAt });
      rerun = true;
      return true;
    }
  }

  // A failed details or companions push is retried later but doesn't hold back the records.
  let detailsOk = true;
  try {
    const details = groupDetails(local);
    const detailsHash = hashOf(details);
    if (detailsHash !== ledger.detailsHash) {
      await convex.mutation(api.groups.updateGroupDetails, { groupId: serverGroupId, data: details, dataUpdatedAt: now });
      if (!stillHere()) return false;
      ledger.detailsHash = detailsHash;
      ledger.detailsUpdatedAt = now;
      writeLedger(owner, info.groupId, ledger);
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
    if (newNames.length > 0) await convex.mutation(api.groups.addCompanions, { groupId: serverGroupId, names: newNames });
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
      ({ rejectedSeq } = await convex.mutation(api.groups.pushRecords, { groupId: serverGroupId, records: batch.map((change) => change.record) }));
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
    writeLedger(owner, info.groupId, ledger);
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
        const local = allGroups().find((trip) => trip.shared?.groupId === server.groupId);
        if (!local?.shared?.myMemberId) continue;
        if (server.seq > readLedger(owner, server.groupId).seenSeq) ok = (await pullGroup(owner, server, local)) && ok;
        const fresh = allGroups().find((trip) => trip.id === local.id);
        if (fresh?.shared) ok = (await pushGroup(owner, fresh)) && ok;
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
  const watch = convex.watchQuery(api.groups.myGroups, {});
  const onList = () => {
    let list: ServerGroup[] | undefined;
    try {
      list = (watch.localQueryResult() as ServerGroup[] | null | undefined) ?? undefined;
    } catch (err) {
      logger.warn("group-sync", "trip list failed", err);
      return;
    }
    if (!list || uid !== userId) return;
    latest = list;
    applyGroupList(userId, list);
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
  for (const trip of allGroups()) {
    if (trip.shared) dropLocalGroup(trip.id, trip.shared.groupId, owner ?? "", true);
  }
  clearGroupLedgers();
  awaitingList.clear();
}

/**
 * Shares a trip or group: creates it on the server, then re-keys it locally to the shared id so every
 * phone (including the owner's others) agrees on the id its expenses point to.
 */
export async function shareGroup(trip: Shareable, ownerName: string, fromGroupId?: string): Promise<string> {
  sharingInFlight += 1;
  let serverId: Id<"sharedGroups">;
  try {
    ({ groupId: serverId } = await convex.mutation(api.groups.shareGroup, {
      data: groupDetails(trip),
      dataUpdatedAt: Date.now(),
      ownerName,
      companions: trip.companions,
      ...(fromGroupId ? { fromGroupId: fromGroupId as Id<"sharedGroups"> } : {}),
    }));
  } finally {
    sharingInFlight -= 1;
  }
  const newId = localGroupId(serverId);
  const owner = uid;
  awaitingList.add(serverId);
  if (owner) writeLedger(owner, serverId, { ...EMPTY_LEDGER, entries: {}, detailsHash: hashOf(groupDetails(trip)), detailsUpdatedAt: Date.now() });

  const wasActive = useTripsStore.getState().activeTripId === trip.id;
  const shared: SharedGroupInfo = { groupId: serverId, myMemberId: "", role: "owner", inviteCode: "", archived: false, muted: false, members: [] };
  setShareables(
    allGroups().map((item) => {
      if (item.id !== trip.id) return item;
      return !isPlanned(item) && isTrip(item) ? { ...item, id: newId, mode: "group", shared } : { ...item, id: newId, shared };
    }),
  );
  if (wasActive) useTripsStore.setState({ activeTripId: newId });
  const retag = <T extends { groupId: string | null }>(items: T[]) => items.map((item) => (item.groupId === trip.id ? { ...item, groupId: newId } : item));
  const money = useExpensesStore.getState();
  useExpensesStore.setState({ expenses: retag(money.expenses), settlements: retag(money.settlements) });
  useEventsStore.setState({
    events: useEventsStore.getState().events.map((item) => (item.tripId === trip.id ? { ...item, tripId: newId } : item)),
  });
  if (owner && latest) {
    applyGroupList(owner, latest);
    void syncNow();
  }
  return newId;
}

/**
 * Archives or unarchives a trip or group from your own lists. Shared ones are per member on the
 * server (with the local copy updated right away); an archived active trip stops being active.
 */
export async function setGroupArchived(group: MoneyGroup, archived: boolean): Promise<void> {
  if (group.shared) {
    await convex.mutation(api.groups.setPreferences, { groupId: group.shared.groupId as Id<"sharedGroups">, archived });
    setShareables(allGroups().map((item) => (item.id === group.id && item.shared ? { ...item, shared: { ...item.shared, archived } } : item)));
  } else if (isTrip(group)) {
    useTripsStore.getState().updateTrip(group.id, { archived });
  } else {
    useTripsStore.getState().updateGroup(group.id, { archived });
  }
  if (archived && useTripsStore.getState().activeTripId === group.id) useTripsStore.getState().clearActiveTrip();
}

/** True when the user's own balance on the trip is zero in every currency, so they may leave. */
export function isSettledUp(trip: Pick<GroupBase, "id">): boolean {
  const totals = new Map<string, number>();
  const add = (currency: string, value: number) => totals.set(currency, (totals.get(currency) ?? 0) + value);
  for (const expense of useExpensesStore.getState().expenses) {
    if (expense.groupId !== trip.id || !expense.shares?.length) continue;
    for (const payer of payersOf(expense)) if (payer.person === SELF_ID) add(expense.currency, payer.amount);
    for (const share of expense.shares) if (share.person === SELF_ID) add(expense.currency, -share.amount);
  }
  for (const settlement of useExpensesStore.getState().settlements) {
    if (settlement.groupId !== trip.id) continue;
    if (settlement.from === SELF_ID) add(settlement.currency, settlement.amount);
    if (settlement.to === SELF_ID) add(settlement.currency, -settlement.amount);
  }
  return [...totals.values()].every((value) => Math.abs(value) < 0.01);
}
