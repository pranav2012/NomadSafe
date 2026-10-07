import type { IconName } from "@/atoms";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import type { EventType } from "@/features/itinerary";
import type { TripStatus } from "@/features/trips/utils/dates";

export interface HomeEvent {
  id: string;
  type: EventType;
  title: string;
  detail?: string;
  time: string;
}

export interface HomeStop {
  name: string;
  latitude: number;
  longitude: number;
}

/** One trip day's spend, split by category in `EXPENSE_CATEGORIES` order; days still ahead are `upcoming`. */
export interface HomeSpendDay {
  amount: number;
  parts: { category: ExpenseCategory; amount: number }[];
  upcoming: boolean;
}

export interface HomeData {
  greeting: string;
  userName: string;
  tripName: string;
  destinations: string[];
  stops: HomeStop[];
  /** 0..1 position of today within the trip. */
  progress: number;
  phase: TripStatus;
  day: number;
  totalDays: number;
  /** Days until the trip starts, or null once it has started. */
  countdown: number | null;
  /** One short date label per trip day. */
  dayDates: string[];
  dayLabel: string;
  daysLeftLabel: string;
  moneyLabel: string;
  moneyValue: string;
  /** One entry per trip day, so the chart keeps the trip's length. */
  spendDays: HomeSpendDay[];
  /** "Food 45% · ₹6,900/day" under the total; null with nothing spent on trip days yet. */
  spendSummary: string | null;
  /** False until the trip has its first spend; Home shows the setup card instead of the total. */
  hasSpends: boolean;
  isSharing: boolean;
  sharingLabel: string;
  travellersLabel: string;
  events: HomeEvent[];
  /** The trip's first itinerary stay, used to pin the hotel on the safety map. */
  stayName: string | null;
}

/** The trip pass while the trip is on (or starts tomorrow): what's on now and what's next. */
export interface LivePass {
  /** "Day 4/21 · Kyoto". */
  heading: string;
  /** Above the perforation: the next leg's route, or what's on now / tonight. */
  top:
    | { kind: "route"; from: string; to: string; fromName: string; toName: string; icon: IconName }
    | { kind: "text"; label: string; title: string; sub?: string };
  /** Below it: the next item's time; null when nothing else is planned. */
  stub: { time: string; label: string; title: string } | null;
  /** On trips with others: what someone else is doing right now, e.g. "Suhas · teamLab · until 18:00". */
  meanwhile?: string;
  /** The items behind "now" and "next", in that order, to offer their tickets. */
  eventIds: string[];
}
