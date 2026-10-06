import { usePlanStore } from "@/modules/billing";
import { track } from "@/modules/analytics";
import { findMoneyGroup, useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useRecurringStore } from "@/features/expenses/store/recurringStore";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { dueDays } from "@/features/expenses/utils/recurring";

/**
 * Adds every recurring spend that has come due since it was last added (Plus only; rules pause on
 * the free plan). Ids derive from the rule and day, so running twice adds nothing.
 */
export function runRecurring(now: Date = new Date()) {
  if (!usePlanStore.getState().unlimitedTrips) return;
  const today = toLocalDayKey(now.toISOString());
  const store = useRecurringStore.getState();
  let added = 0;
  for (const rule of store.rules) {
    if (rule.groupId && !findMoneyGroup(useTripsStore.getState(), rule.groupId)) {
      store.remove(rule.id);
      continue;
    }
    const days = dueDays(rule.startDate, rule.frequency, rule.lastAddedDate, today);
    if (days.length === 0) continue;
    const created = useExpensesStore.getState().addExpenses(
      days.map((day) => ({
        ...rule.template,
        groupId: rule.groupId,
        date: new Date(`${day}T12:00:00`).toISOString(),
        source: "recurring" as const,
        externalId: `recurring:${rule.id}:${day}`,
      })),
    );
    added += created.length;
    store.update(rule.id, { lastAddedDate: days[days.length - 1] });
  }
  if (added > 0) track("recurring_added", { count: added });
}
