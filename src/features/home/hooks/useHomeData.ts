import { useMemo } from "react";
import { useAuthStore } from "@/features/auth";
import { EXPENSE_CATEGORY_IDS, type ExpenseCategory } from "@/features/expenses/constants/categories";
import { useTripExpenseSummary } from "@/features/expenses/hooks/useTripExpenseSummary";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { formatMoney } from "@/features/expenses/utils/money";
import { useEventsStore } from "@/features/itinerary";
import { useSharingStore } from "@/features/location-sharing";
import { getDestinationCoordinates, selectActiveTrip, useTripsStore } from "@/features/trips/store/tripsStore";
import { addDays, countInclusiveDays, daysLeftInTrip, fromDateKey, getTripStatus, startOfLocalDay } from "@/features/trips/utils/dates";
import { useNow } from "@/hooks/useNow";
import { useLocalization } from "@/localization";
import type { HomeData, HomeEvent, HomeSpendDay } from "@/features/home/types";
import { dateTimeFormat } from "@/utils/intl";

function greetingKeyFor(hour: number) {
  if (hour >= 5 && hour < 12) return "trip.goodMorning";
  if (hour >= 12 && hour < 17) return "trip.goodAfternoon";
  return "trip.goodEvening";
}

/** Everything Home renders for the active trip, already formatted; null without an active trip. */
export function useHomeData(): HomeData | null {
  const { t, locale, hour12, formatCurrency } = useLocalization();
  const user = useAuthStore((state) => state.user);
  const trip = useTripsStore(selectActiveTrip);
  const allEvents = useEventsStore((state) => state.events);
  const isSharing = useSharingStore((state) => state.isBroadcasting);
  const summary = useTripExpenseSummary(trip);
  const now = useNow();
  // Stable per trip, so the globe's pins, weather and imagery don't recompute on every Home render.
  const stops = useMemo(
    () =>
      trip
        ? getDestinationCoordinates(trip).flatMap((coord, i) =>
            coord ? [{ name: trip.destinations[i] ?? "", latitude: coord.latitude, longitude: coord.longitude }] : [],
          )
        : [],
    [trip],
  );

  const userName = user?.name?.split(" ")[0] ?? t("common.fallbackUser");
  const greeting = t(greetingKeyFor(now.getHours()));
  const timeFormatter = dateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit", hour12 });
  const shortDate = dateTimeFormat(locale, { month: "short", day: "numeric" });
  const sharingLabel = isSharing ? t("trip.sharingLive") : t("trip.notSharing");

  if (!trip) return null;

  const start = fromDateKey(trip.startDate);
  const end = fromDateKey(trip.endDate);
  const totalDays = countInclusiveDays(start, end);
  const status = getTripStatus(trip, now);
  const day =
    status === "upcoming" ? 0 : status === "complete" ? totalDays : Math.min(countInclusiveDays(start, startOfLocalDay(now)), totalDays);
  const dayDates = Array.from({ length: totalDays }, (_, i) => shortDate.format(addDays(start, i)));

  const byDay = new Map<string, Map<ExpenseCategory, number>>();
  for (const { expense, amount } of summary.convertedExpenses) {
    const key = toLocalDayKey(expense.date);
    const categories = byDay.get(key) ?? new Map<ExpenseCategory, number>();
    categories.set(expense.category, (categories.get(expense.category) ?? 0) + amount);
    byDay.set(key, categories);
  }
  const spendDays: HomeSpendDay[] = Array.from({ length: totalDays }, (_, i) => {
    const categories = byDay.get(toLocalDayKey(addDays(start, i)));
    const parts = EXPENSE_CATEGORY_IDS.flatMap((category) => {
      const amount = categories?.get(category) ?? 0;
      return amount > 0 ? [{ category, amount }] : [];
    });
    return { amount: parts.reduce((sum, part) => sum + part.amount, 0), parts, upcoming: i >= day };
  });
  const tripDaysSpent = spendDays.reduce((sum, entry) => sum + (entry.upcoming ? 0 : entry.amount), 0);
  const topCategory = summary.categoryTotals[0];
  const spendSummary =
    topCategory && summary.total > 0
      ? [
          t("home.spendTopShare", {
            category: t(`expenses.category.${topCategory.category}`),
            pct: Math.round((topCategory.amount / summary.total) * 100),
          }),
          ...(day > 0 && tripDaysSpent > 0
            ? [t("money.pace.perDay", { amount: formatMoney(formatCurrency, tripDaysSpent / day, trip.currency) })]
            : []),
        ].join(" · ")
      : null;

  const events: HomeEvent[] = allEvents
    .filter((event) => event.tripId === trip.id && new Date(event.startAt).getTime() >= now.getTime() - 3_600_000)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 5)
    .map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      detail: event.detail,
      time: timeFormatter.format(new Date(event.startAt)),
    }));

  return {
    greeting,
    userName,
    tripName: trip.name,
    destinations: trip.destinations,
    stops,
    progress: totalDays > 0 ? day / totalDays : 0,
    phase: status,
    day,
    totalDays,
    countdown: status === "upcoming" ? Math.max(1, countInclusiveDays(now, start) - 1) : null,
    dayDates,
    dayLabel:
      status === "upcoming"
        ? t("trip.startsIn", { count: Math.max(1, countInclusiveDays(now, start) - 1) })
        : status === "complete"
          ? t("trip.completed")
          : t("trip.dayProgress", { day, total: totalDays }),
    daysLeftLabel: t("trip.daysLeft", { count: daysLeftInTrip(trip, now) }),
    moneyLabel: t("trip.spent"),
    moneyValue: formatMoney(formatCurrency, summary.total, trip.currency),
    spendDays,
    spendSummary,
    hasSpends: summary.convertedExpenses.length > 0 || summary.unavailableExpenses.length > 0,
    isSharing,
    sharingLabel,
    travellersLabel: trip.mode === "solo" ? t("trip.solo") : t("trip.groupWithCount", { count: trip.companions.length + 1 }),
    events,
    stayName: allEvents.find((event) => event.tripId === trip.id && event.type === "stay")?.title ?? null,
  };
}
