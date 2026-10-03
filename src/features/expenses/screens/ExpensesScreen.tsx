import React, { useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { BlurTargetView } from "expo-blur";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraCard } from "@/components/aura/AuraCard";
import { AuraSection } from "@/components/aura/AuraSection";
import { AuraSegmented } from "@/components/aura/AuraSegmented";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { TAB_BAR_GAP, TAB_BAR_HEIGHT, useKeyboardVisible, useTabBarInset } from "@/components/tabbar/tabBarInset";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { hasTripBudget, selectActiveTrip, type Trip, useTripsStore } from "@/features/trips/store/tripsStore";
import { TripFormSheet } from "@/features/trips/components/TripForm";
import { countInclusiveDays, fromDateKey, getTripStatus, startOfLocalDay } from "@/features/trips/utils/dates";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { averagePerDay, categoryBreakdown, dailySeries, filterByTrip, sumAmount } from "@/features/expenses/utils/aggregate";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { useGmailAutoSync } from "@/features/expenses/hooks/useGmailAutoSync";
import { dismissGmailLostAccess, hasGmailGrant, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";
import { formatMoney } from "@/features/expenses/utils/money";
import { isSplitExpense } from "@/features/expenses/utils/split";
import { CAPTURE_BAR_HEIGHT, CaptureBar } from "@/features/expenses/components/CaptureBar";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";
import { ExpenseRow } from "@/features/expenses/components/ExpenseRow";
import { ImportSheet } from "@/features/expenses/components/ImportSheet";
import { RunwayHero } from "@/features/expenses/components/RunwayHero";
import { TripBalances } from "@/features/expenses/components/TripBalances";

const AVG_DAYS = 14;
const LEDGER_PAGE = 30;

type MoneyView = "spending" | "splits";

/** Days left (today included) and share of the trip already elapsed. */
function tripTiming(trip: Trip) {
  const total = countInclusiveDays(fromDateKey(trip.startDate), fromDateKey(trip.endDate));
  const status = getTripStatus(trip);
  if (status === "complete") return { daysLeft: 0, elapsed: 1 };
  if (status === "upcoming") return { daysLeft: total, elapsed: 0 };
  const daysLeft = countInclusiveDays(startOfLocalDay(new Date()), fromDateKey(trip.endDate));
  return { daysLeft, elapsed: (total - daysLeft) / Math.max(1, total) };
}

/** Money tab: daily runway hero, the ledger or splits, and a floating capture bar. */
export default function ExpensesScreen() {
  const { c, f, isDark } = useAura();
  const { t, currency: deviceCurrency, formatCurrency } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const keyboardVisible = useKeyboardVisible();
  const blurTarget = useRef<View>(null);
  const activeTrip = useTripsStore(selectActiveTrip);
  const expenses = useExpensesStore((state) => state.expenses);
  const settlements = useExpensesStore((state) => state.settlements);
  const [view, setView] = useState<MoneyView>("spending");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [importTab, setImportTab] = useState<"paste" | "gmail" | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE);
  const autoSync = useGmailAutoSync(activeTrip);
  const gmailLostAccess = useGmailConnectionStore((state) => state.lostAccess && !hasGmailGrant(state.tokens));

  const currency = activeTrip?.currency ?? deviceCurrency;
  const scoped = useMemo(() => filterByTrip(expenses, activeTrip?.id ?? null), [expenses, activeTrip?.id]);
  const sorted = useMemo(() => [...scoped].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [scoped]);
  const conversion = useConvertedExpenses(scoped, currency);
  // Aggregates run on amounts converted to the display currency so they match Home.
  const converted: Expense[] = conversion.convertedExpenses.map(({ expense, amount }) => ({ ...expense, amount, currency }));
  const total = sumAmount(converted);
  const budget = activeTrip && hasTripBudget(activeTrip) ? activeTrip.budget : 0;
  const timing = activeTrip ? tripTiming(activeTrip) : { daysLeft: 0, elapsed: 0 };
  const unconvertedLabel = conversion.unconvertedTotals.map((entry) => formatMoney(formatCurrency, entry.amount, entry.currency)).join(" + ");

  const hasSplits =
    !!activeTrip &&
    (activeTrip.companions.length > 0 ||
      scoped.some(isSplitExpense) ||
      settlements.some((settlement) => settlement.tripId === activeTrip.id));
  const shownView = hasSplits ? view : "spending";

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openVoice = () => {
    setFormOpen(false);
    router.push({ pathname: "/voice-expense", params: activeTrip ? { tripId: activeTrip.id } : {} });
  };

  const captureBottom = insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + 10;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <BlurTargetView ref={blurTarget} style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: tabBarInset + CAPTURE_BAR_HEIGHT + 28 }]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("tabs.money")}</Text>
            <PressableScale
              onPress={() => setImportTab("paste")}
              accessibilityRole="button"
              accessibilityLabel={t("expenses.importTitle")}
              style={[styles.headerButton, { backgroundColor: c.surfaceStrong }]}
            >
              <Icon name="download" size={17} color={c.text} />
            </PressableScale>
          </View>

          {autoSync.importedCount ? (
            <Banner icon="mail" text={t("expenses.autoSynced", { count: autoSync.importedCount })} onDismiss={autoSync.dismiss} />
          ) : null}
          {gmailLostAccess ? (
            <Banner
              icon="mail"
              tone={auraStatusAccent.live}
              text={t("expenses.gmailLostAccess")}
              action={{ label: t("expenses.gmailReconnect"), onPress: () => setImportTab("gmail") }}
              onDismiss={dismissGmailLostAccess}
            />
          ) : null}

          <RunwayHero
            label={activeTrip?.name ?? null}
            currency={currency}
            total={total}
            budget={budget}
            daysLeft={timing.daysLeft}
            elapsed={timing.elapsed}
            avgPerDay={averagePerDay(dailySeries(converted, AVG_DAYS))}
            breakdown={categoryBreakdown(converted)}
            note={
              unconvertedLabel
                ? conversion.isConverting
                  ? t("expenses.convertingAmounts", { amount: unconvertedLabel })
                  : t("expenses.notConverted", { amount: unconvertedLabel })
                : null
            }
            onSetBudget={activeTrip ? () => setBudgetOpen(true) : undefined}
          />

          {hasSplits ? (
            <AuraSegmented
              options={[
                { value: "spending", label: t("expenses.tabSpending") },
                { value: "splits", label: t("expenses.tabSplits") },
              ]}
              value={shownView}
              onChange={setView}
              style={styles.segmented}
            />
          ) : null}

          {shownView === "splits" && activeTrip ? (
            <Animated.View key="splits" entering={FadeIn.duration(220)} style={styles.panel}>
              <TripBalances trip={activeTrip} />
            </Animated.View>
          ) : sorted.length === 0 ? (
            <Animated.View key="empty" entering={FadeIn.duration(220)}>
              <AuraCard style={styles.empty}>
                <Icon name="wallet" size={22} color={c.textSoft} />
                <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{t("expenses.noExpensesTitle")}</Text>
                <Text style={[styles.emptyBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("expenses.noExpensesBody")}</Text>
                <AuraButton label={t("expenses.importTitle")} icon="download" variant="secondary" size="md" onPress={() => setImportTab("paste")} style={styles.emptyButton} />
              </AuraCard>
            </Animated.View>
          ) : (
            <Animated.View key="spending" entering={FadeIn.duration(220)}>
              <AuraSection title={t("expenses.recent")} style={hasSplits ? styles.sectionTight : undefined} />
              {sorted.slice(0, ledgerLimit).map((expense, index) => (
                <Animated.View key={expense.id} entering={index < 12 ? FadeInDown.duration(220).delay(index * 25) : undefined}>
                  <ExpenseRow
                    expense={expense}
                    onPress={() => {
                      setEditing(expense);
                      setFormOpen(true);
                    }}
                  />
                </Animated.View>
              ))}
              {sorted.length > ledgerLimit ? (
                <AuraButton
                  label={t("expenses.seeAll", { count: sorted.length })}
                  variant="secondary"
                  size="md"
                  onPress={() => setLedgerLimit(sorted.length)}
                  style={styles.more}
                />
              ) : null}
            </Animated.View>
          )}
        </ScrollView>
      </BlurTargetView>

      {!keyboardVisible ? (
        <CaptureBar bottom={captureBottom} onAdd={openAdd} onVoice={openVoice} blurTarget={Platform.OS === "android" ? blurTarget : undefined} />
      ) : null}

      <ExpenseForm
        visible={formOpen}
        editingExpense={editing}
        tripId={activeTrip?.id ?? null}
        tripCurrency={currency}
        companions={activeTrip?.companions}
        onSave={() => setFormOpen(false)}
        onCancel={() => setFormOpen(false)}
        onSpeak={openVoice}
      />
      <ImportSheet
        visible={importTab !== null}
        tripId={activeTrip?.id ?? null}
        trip={activeTrip}
        initialTab={importTab ?? "paste"}
        onClose={() => setImportTab(null)}
        onImported={() => setImportTab(null)}
      />
      <TripFormSheet visible={budgetOpen} editingTrip={activeTrip} onClose={() => setBudgetOpen(false)} />
    </View>
  );
}

function Banner({
  icon,
  text,
  tone,
  action,
  onDismiss,
}: {
  icon: "mail";
  text: string;
  tone?: string;
  action?: { label: string; onPress: () => void };
  onDismiss: () => void;
}) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  return (
    <AuraCard tone={tone} style={styles.banner}>
      <View style={styles.bannerRow}>
        <Icon name={icon} size={16} color={tone ?? c.textSoft} />
        <Text style={[styles.bannerText, { color: c.text, fontFamily: f.regular }]}>{text}</Text>
        {action ? (
          <PressableScale onPress={action.onPress} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.bannerAction, { color: c.text, fontFamily: f.semibold }]}>{action.label}</Text>
          </PressableScale>
        ) : null}
        <PressableScale onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close")}>
          <Icon name="x" size={15} color={c.textMuted} />
        </PressableScale>
      </View>
    </AuraCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { fontSize: 34, letterSpacing: -1.2 },
  headerButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  banner: { marginBottom: 12, paddingVertical: 12 },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  bannerAction: { fontSize: 13.5 },
  segmented: { marginTop: 28 },
  panel: { marginTop: 22 },
  sectionTight: { marginTop: 22 },
  empty: { marginTop: 28, gap: 8 },
  emptyTitle: { fontSize: 18, marginTop: 4 },
  emptyBody: { fontSize: 14.5, lineHeight: 21 },
  emptyButton: { alignSelf: "flex-start", marginTop: 8 },
  more: { alignSelf: "center", marginTop: 12 },
});
