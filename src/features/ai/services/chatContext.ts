import { useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { getCachedExchangeRate } from "@/features/expenses/services/currencyConversion";

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function fromDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function countInclusiveDays(startDate: Date, endDate: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return Math.max(1, Math.round((end - start) / msPerDay) + 1);
}

function tripProgress(trip: Trip) {
  const today = startOfLocalDay(new Date());
  const start = startOfLocalDay(fromDateKey(trip.startDate));
  const end = startOfLocalDay(fromDateKey(trip.endDate));
  const totalDays = countInclusiveDays(start, end);

  if (today < start) return { status: "upcoming" as const, day: 0, totalDays };
  if (today > end) return { status: "completed" as const, day: totalDays, totalDays };
  return {
    status: "active" as const,
    day: Math.min(countInclusiveDays(start, today), totalDays),
    totalDays,
  };
}

function money(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * Builds a factual context block about the user's active trip and its budget
 * for the chat model. Returns null when there is no trip to talk about.
 *
 * Includes recorded expenses already converted by the dashboard's shared rate cache.
 */
export function buildTripMoneyContext(): string | null {
  const { trips, activeTripId } = useTripsStore.getState();
  const trip = trips.find((t) => t.id === activeTripId) ?? null;
  if (!trip) return null;

  const { status, day, totalDays } = tripProgress(trip);
  const dailyBudget = trip.budget / totalDays;
  const tripExpenses = useExpensesStore
    .getState()
    .expenses.filter((expense) => expense.tripId === trip.id);
  const convertedExpenses = tripExpenses.flatMap((expense) => {
    const rate = getCachedExchangeRate(expense.currency, trip.currency, expense.date);
    return rate ? [expense.amount * rate.rate] : [];
  });
  const actualSpent = convertedExpenses.reduce((sum, amount) => sum + amount, 0);
  const pendingConversions = tripExpenses.length - convertedExpenses.length;
  const remaining = Math.max(0, trip.budget - actualSpent);
  const travelers =
    trip.mode === "group" ? `group of ${trip.companions.length + 1}` : "solo";

  const lines = [
    "USER TRIP & MONEY CONTEXT (use this to answer; do not invent other numbers):",
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    `Trip: ${trip.name}`,
    `Destinations: ${trip.destinations.join(", ") || "not set"}`,
    `Dates: ${trip.startDate} to ${trip.endDate} (${totalDays} days, status: ${status}${
      status === "active" ? `, day ${day} of ${totalDays}` : ""
    })`,
    `Travelers: ${travelers}${
      trip.companions.length ? ` (companions: ${trip.companions.join(", ")})` : ""
    }`,
    `Currency: ${trip.currency}`,
    `Total budget: ${money(trip.budget, trip.currency)}`,
    `Daily budget: ${money(dailyBudget, trip.currency)}`,
    `Recorded spend so far: ${money(actualSpent, trip.currency)} across ${convertedExpenses.length} expenses`,
    `Budget remaining: ${money(remaining, trip.currency)}`,
    pendingConversions > 0
      ? `${pendingConversions} expense(s) are excluded until their reference exchange rates load.`
      : "All recorded trip expenses are included using their expense-date reference rates.",
  ];

  return lines.join("\n");
}
