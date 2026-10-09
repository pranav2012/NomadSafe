import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { parseParty, planAutoSplit, type SplitHint } from "@/features/expenses/utils/party";
import { SELF_ID, splitEqually, type ExpensePayer, type ExpenseShare } from "@/features/expenses/utils/split";
import { isGenericTitle, sameBooking, type BookingLike } from "@/features/itinerary/utils/bookings";

const BOOKING_CATEGORIES = new Set<ExpenseCategory>(["stays", "travel"]);

/** A Gmail spend is a booking when its category, the provider or a booking parsed from the same email says so. */
export function isBookingSpend(category: ExpenseCategory, signals: { committedBooking: boolean; hasBooking: boolean }): boolean {
  return BOOKING_CATEGORIES.has(category) || signals.committedBooking || signals.hasBooking;
}

export interface DefaultSplit {
  paidBy?: string;
  shares?: ExpenseShare[];
  splitHint?: SplitHint;
}

/** Proposed split on a trip with others: the email's head-count when it has one, else bookings split equally, the rest just yours. */
export function defaultSpendSplit(input: {
  text: string;
  amount: number;
  currency: string;
  booking: boolean;
  companions: string[];
  selfName?: string | null;
}): DefaultSplit {
  const { text, amount, currency, booking, companions, selfName } = input;
  if (companions.length === 0) return {};
  const party = parseParty(text);
  const plan = planAutoSplit(party, { amount, currency, companions, selfName, shared: false });
  if (plan?.kind === "split") return { paidBy: SELF_ID, shares: plan.shares };
  if (plan?.kind === "hint") return { splitHint: plan.hint };
  if (party.pax === 1 || !booking) return {};
  return { paidBy: SELF_ID, shares: splitEqually(amount, currency, [SELF_ID, ...companions]) };
}

/** "Agoda <no-reply@agoda.com>" → "Agoda"; a bare address gives its domain's name ("no-reply@agoda.com" → "Agoda"). */
export function emailSenderName(sender: string | undefined): string {
  if (!sender) return "";
  const display = sender.replace(/<[^>]*>/g, "").replace(/["']/g, "").trim();
  if (display && !display.includes("@")) return display;
  const address = sender.match(/[^\s<@]+@([^\s>]+)/)?.[1] ?? "";
  const parts = address.toLowerCase().split(".").filter(Boolean);
  const name = parts.length >= 2 ? parts[parts.length - (/^(?:co|com|org|net)$/.test(parts[parts.length - 2]) ? 3 : 2)] : parts[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** True when a note still holds the email an older version imported into it (new notes are a short source line). */
export function isLegacyImportedNote(note: string | undefined, emailText: string): boolean {
  if (!note) return false;
  const body = emailText.split("\n\n").slice(1).join(" ");
  const sample = normalize(body || emailText).slice(0, 60);
  return sample.length >= 12 && normalize(note).includes(sample);
}

export interface ImportedExpenseLike {
  source: string;
  externalId?: string;
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  date: string;
  note?: string;
  paidBy?: string;
  payers?: ExpensePayer[];
  shares?: ExpenseShare[];
  location?: unknown;
}

function isEqualSplitByYou(expense: ImportedExpenseLike): boolean {
  if (!expense.shares?.length) return true;
  if (expense.payers?.length || (expense.paidBy !== undefined && expense.paidBy !== SELF_ID)) return false;
  const equal = splitEqually(expense.amount, expense.currency, expense.shares.map((share) => share.person));
  return equal.every((share, index) => share.amount === expense.shares?.[index]?.amount);
}

/** A Gmail spend an older version added straight to the ledger that the user never changed. */
export function isUntouchedImportedExpense(
  expense: ImportedExpenseLike,
  fresh: Pick<ImportedExpenseLike, "merchant" | "amount" | "currency" | "category" | "date">,
  emailText: string,
): boolean {
  return (
    expense.source === "email" &&
    expense.merchant === fresh.merchant &&
    expense.amount === fresh.amount &&
    expense.currency === fresh.currency &&
    expense.category === fresh.category &&
    toLocalDayKey(expense.date) === toLocalDayKey(fresh.date) &&
    !expense.location &&
    isEqualSplitByYou(expense) &&
    isLegacyImportedNote(expense.note, emailText)
  );
}

export interface ImportedEventLike {
  id: string;
  tripId: string | null;
  source: string;
  note?: string;
  editedAt?: string;
  doneAt?: string;
  ticketHolders?: string[];
  externalId?: string;
  sourceIds?: string[];
}

export function eventMessageIds(event: Pick<ImportedEventLike, "externalId" | "sourceIds">): string[] {
  return [...new Set([event.externalId, ...(event.sourceIds ?? [])].filter((id): id is string => Boolean(id)).map((id) => id.replace(/#\d+$/, "")))];
}

/**
 * Older auto-imported bookings that go back to review on the re-read: untouched, imported on this
 * phone (the note holds the email), all their emails re-read, and never on a shared trip.
 */
export function selectReturnableEvents<T extends ImportedEventLike>(
  events: T[],
  options: { tripId: string; shared: boolean; messageIds: Set<string>; ticketEventIds: Set<string> },
): T[] {
  if (options.shared) return [];
  return events.filter((event) => {
    if (event.tripId !== options.tripId || event.source !== "email" || !event.note) return false;
    if (event.editedAt || event.doneAt || event.ticketHolders?.length || options.ticketEventIds.has(event.id)) return false;
    const ids = eventMessageIds(event);
    return ids.length > 0 && ids.every((id) => options.messageIds.has(id));
  });
}

export function spendKey(spend: { amount: number; currency: string; date: string }): string {
  return `${spend.currency}|${spend.amount.toFixed(2)}|${toLocalDayKey(spend.date)}`;
}

/** Same email, or a generic title ("Booking") with the amount and day of a named spend. */
export function isRepeatSpend(
  spend: { merchant: string; amount: number; currency: string; date: string; externalId?: string },
  others: { merchant: string; amount: number; currency: string; date: string; externalId?: string }[],
): boolean {
  if (spend.externalId && others.some((other) => other.externalId === spend.externalId)) return true;
  if (!isGenericTitle(spend.merchant)) return false;
  const key = spendKey(spend);
  return others.some((other) => !isGenericTitle(other.merchant) && spendKey(other) === key);
}

export function findSameBooking(list: BookingLike[], incoming: BookingLike): number {
  return list.findIndex((item) => sameBooking(item, incoming));
}

/** Dismissed by any email it came from, or as the same booking from a new email. */
export function isDismissedBooking(dismissed: { ids: string[]; bookings: BookingLike[] }, incoming: BookingLike): boolean {
  const ids = [incoming.externalId, ...(incoming.sourceIds ?? [])].filter(Boolean);
  if (ids.some((id) => dismissed.ids.includes(id as string))) return true;
  return findSameBooking(dismissed.bookings, incoming) >= 0;
}
