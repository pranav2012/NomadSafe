import { SELF_ID } from "@/features/expenses/utils/split";
import type { Expense } from "@/features/expenses/store/expensesStore";
import type { Trip } from "@/features/trips/store/tripsStore";
import { storage } from "@/modules/storage";

export type SharedKind = "expense" | "settlement" | "event";

const GROUP_LEDGER_PREFIX = "group-ledger:";

export function groupLedgerKey(uid: string, serverTripId: string) {
  return `${GROUP_LEDGER_PREFIX}${uid}:${serverTripId}`;
}

/** Removes every shared-trip ledger on this phone (sign-out, account switch). */
export function clearGroupLedgers() {
  for (const key of storage.getAllKeys()) if (key.startsWith(GROUP_LEDGER_PREFIX)) storage.remove(key);
}

/** An expense other members need to see: it's split, or someone else paid it. */
export function isGroupExpense(expense: Pick<Expense, "shares" | "paidBy">): boolean {
  return (expense.shares?.length ?? 0) > 0 || (expense.paidBy !== undefined && expense.paidBy !== SELF_ID);
}

type LocalOnly = { rawText?: string; note?: string; source?: string };

/** Raw imported text, and the note of an email import (sender, subject, body), never leave the device. */
export function stripRaw<T extends LocalOnly>(record: T): Omit<T, "rawText"> {
  const { rawText: _raw, ...rest } = record;
  if (record.source !== "email" || rest.note === undefined) return rest;
  const { note: _note, ...withoutNote } = rest;
  return withoutNote as Omit<T, "rawText">;
}

/** Copies the fields `stripRaw` kept off the server from the local copy onto an incoming record. */
export function keepLocalOnly<T extends LocalOnly>(next: T, previous: LocalOnly | undefined): T {
  if (!previous) return next;
  if (previous.rawText !== undefined) next.rawText = previous.rawText;
  if (next.source === "email" && next.note === undefined && previous.note !== undefined) next.note = previous.note;
  return next;
}

/**
 * Decides which engine owns a record on a shared trip, and both engines must agree. Settlements and
 * events always belong to the trip. An expense does when it's a group expense, or when it has already
 * been synced with the trip: on the payer's phone "paid by you, not split" doesn't look like a group
 * expense, but it still is one for everyone else.
 */
export function makeSharedScope(uid: string | null, trips: Trip[]) {
  const sharedById = new Map(trips.filter((trip) => trip.shared).map((trip) => [trip.id, trip.shared!.tripId]));
  const ledgerKeys = new Map<string, Set<string>>();
  const syncedKeys = (serverTripId: string) => {
    let keys = ledgerKeys.get(serverTripId);
    if (!keys) {
      keys = new Set();
      try {
        const raw = uid ? storage.getString(groupLedgerKey(uid, serverTripId)) : undefined;
        if (raw) keys = new Set(Object.keys((JSON.parse(raw) as { entries?: Record<string, unknown> }).entries ?? {}));
      } catch {}
      ledgerKeys.set(serverTripId, keys);
    }
    return keys;
  };
  return {
    isSharedTrip: (tripId: string | null) => tripId !== null && sharedById.has(tripId),
    has: (kind: SharedKind, record: { id: string; tripId: string | null } & Partial<Pick<Expense, "shares" | "paidBy">>) => {
      const serverTripId = record.tripId === null ? undefined : sharedById.get(record.tripId);
      if (!serverTripId) return false;
      if (kind !== "expense") return true;
      return isGroupExpense(record) || syncedKeys(serverTripId).has(`expense:${record.id}`);
    },
  };
}
