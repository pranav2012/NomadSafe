import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { getCategoryMeta } from "@/features/expenses/constants/categories";
import {
  averagePerDay,
  categoryBreakdown,
  dailySeries,
  filterByTrip,
  sumAmount,
  topMerchants,
} from "@/features/expenses/utils/aggregate";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";
import { ImportSheet } from "@/features/expenses/components/ImportSheet";
import { useGmailAutoSync } from "@/features/expenses/hooks/useGmailAutoSync";

const CHART_DAYS = 14;

function countTripDays(startDate: string, endDate: string): number {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)) + 1);
}

function daysLeft(endDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
}

export default function ExpensesScreen() {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  // The hero is an always-dark surface; in dark mode `inkDeep`/`paperSoft`
  // invert, so derive a fixed dark background and light-on-dark text instead.
  const heroBg = isDark ? theme.paperDeep : theme.inkDeep;
  const heroText = isDark ? theme.whiteText : theme.paperSoft;
  const { t, locale, currency: deviceCurrency, formatCurrency } = useLocalization();

  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? null;

  const expenses = useExpensesStore((state) => state.expenses);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const autoSync = useGmailAutoSync(activeTrip);

  const currency = activeTrip?.currency ?? deviceCurrency;

  const scoped = filterByTrip(expenses, activeTrip?.id ?? null);
  const series = dailySeries(scoped, CHART_DAYS);
  const data = {
    scoped,
    sorted: [...scoped].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    ),
    total: sumAmount(scoped),
    breakdown: categoryBreakdown(scoped),
    series,
    avgDay: averagePerDay(series),
    merchants: topMerchants(scoped, 4),
  };

  const budget = activeTrip?.budget ?? 0;
  const tripDays = activeTrip ? countTripDays(activeTrip.startDate, activeTrip.endDate) : 0;
  const budgetDaily = budget > 0 && tripDays > 0 ? budget / tripDays : data.avgDay;
  const remaining = budget - data.total;

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setFormOpen(true);
  };

  return (
    <SafeAreaView edges={["top"]} style={[styles.root, { backgroundColor: theme.paper }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>{t("expenses.eyebrow")}</Text>
            <Text style={[styles.heroTitle, { color: theme.inkDeep }]}>{t("expenses.title")}</Text>
          </View>
          <Pressable
            onPress={openAdd}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: theme.inkDeep, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Icon name="plus" size={18} color={theme.paperSoft} />
          </Pressable>
        </View>

        {autoSync.importedCount ? (
          <View style={[styles.syncBanner, { backgroundColor: theme.tealSoft, borderColor: theme.teal }]}>
            <Icon name="mail" size={16} color={theme.teal} />
            <Text style={[styles.syncBannerText, { color: theme.inkDeep }]}>
              {t("expenses.autoSynced", { count: autoSync.importedCount })}
            </Text>
            <Pressable onPress={autoSync.dismiss} hitSlop={8}>
              <Icon name="x" size={16} color={theme.inkSoft} />
            </Pressable>
          </View>
        ) : null}

        {/* Hero total */}
        <View style={[styles.heroCard, { backgroundColor: heroBg }]}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTotalBlock}>
              <Text style={[styles.heroLabel, { color: theme.whiteTextMuted }]}>
                {activeTrip ? activeTrip.name : t("expenses.allTime")}
              </Text>
              <Text style={[styles.heroAmount, { color: heroText }]}>
                {formatCurrency(data.total, currency, { maximumFractionDigits: 0 })}
              </Text>
              <Text style={[styles.heroSub, { color: theme.whiteTextMuted }]}>
                {budget > 0
                  ? activeTrip
                    ? t("expenses.ofBudget", {
                        budget: formatCurrency(budget, currency, { maximumFractionDigits: 0 }),
                        days: daysLeft(activeTrip.endDate),
                      })
                    : t("expenses.ofBudgetNoDays", {
                        budget: formatCurrency(budget, currency, { maximumFractionDigits: 0 }),
                      })
                  : t("expenses.noBudget")}
              </Text>
            </View>
            {budget > 0 ? (
              <View style={[styles.heroPill, { backgroundColor: theme.whiteOverlayStrong }]}>
                <Icon
                  name={remaining >= 0 ? "trendDown" : "trendUp"}
                  size={12}
                  color={theme.cream}
                  strokeWidth={2}
                />
                <Text style={[styles.heroPillText, { color: theme.cream }]}>
                  {remaining >= 0
                    ? t("expenses.remaining", {
                        amount: formatCurrency(remaining, currency, { maximumFractionDigits: 0 }),
                      })
                    : t("expenses.overBudget", {
                        amount: formatCurrency(Math.abs(remaining), currency, { maximumFractionDigits: 0 }),
                      })}
                </Text>
              </View>
            ) : null}
          </View>

          {data.breakdown.length > 0 ? (
            <View style={styles.budgetBarWrap}>
              <View style={[styles.budgetBar, { backgroundColor: theme.whiteOverlay }]}>
                {data.breakdown.map((entry) => {
                  const widthPct =
                    budget > 0
                      ? Math.min(100, (entry.amount / budget) * 100)
                      : entry.pct;
                  return (
                    <View
                      key={entry.category}
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: theme[getCategoryMeta(entry.category).color],
                      }}
                    />
                  );
                })}
              </View>
              <View style={styles.legendRow}>
                {data.breakdown.slice(0, 4).map((entry) => (
                  <View key={entry.category} style={styles.legendItem}>
                    <View style={styles.legendTop}>
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: theme[getCategoryMeta(entry.category).color] },
                        ]}
                      />
                      <Text style={[styles.legendLabel, { color: theme.whiteTextMuted }]}>
                        {t(`expenses.category.${entry.category}`)}
                      </Text>
                    </View>
                    <Text style={[styles.legendAmount, { color: heroText }]}>
                      {formatCurrency(entry.amount, currency, { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* 14-day chart */}
        {data.scoped.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>
                  {t("expenses.spendLastDays", { count: CHART_DAYS })}
                </Text>
                <Text style={[styles.chartAvg, { color: theme.inkDeep }]}>
                  {formatCurrency(data.avgDay, currency, { maximumFractionDigits: 0 })}{" "}
                  <Text style={[styles.chartAvgUnit, { color: theme.inkMuted }]}>
                    {t("expenses.avgPerDay")}
                  </Text>
                </Text>
              </View>
              <View style={styles.chartLegend}>
                <View style={[styles.legendLine, { backgroundColor: theme.teal }]} />
                <Text style={[styles.legendTiny, { color: theme.inkSoft }]}>{t("expenses.actual")}</Text>
                <View style={[styles.legendLine, { backgroundColor: theme.stamp, marginLeft: 8 }]} />
                <Text style={[styles.legendTiny, { color: theme.inkSoft }]}>{t("expenses.budgetLabel")}</Text>
              </View>
            </View>
            <SpendChart
              values={data.series.map((entry) => entry.amount)}
              budgetDaily={budgetDaily}
              lineColor={theme.teal}
              budgetColor={theme.stamp}
              gridColor={theme.hairline}
            />
          </View>
        ) : null}

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <Pressable
            onPress={() => setImportOpen(true)}
            style={({ pressed }) => [
              styles.quickCard,
              {
                backgroundColor: theme.mustardSoft,
                borderColor: theme.mustard,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Icon name="download" size={22} color={theme.stamp} strokeWidth={1.8} />
            <Text style={[styles.quickTitle, { color: theme.inkDeep }]}>{t("expenses.importTitle")}</Text>
            <Text style={[styles.quickSub, { color: theme.inkSoft }]}>{t("expenses.importSub")}</Text>
          </Pressable>
          <Pressable
            onPress={openAdd}
            style={({ pressed }) => [
              styles.quickCard,
              { backgroundColor: theme.tealSoft, borderColor: theme.hairline, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Icon name="plus" size={22} color={theme.teal} strokeWidth={1.8} />
            <Text style={[styles.quickTitle, { color: theme.inkDeep }]}>{t("expenses.addManualTitle")}</Text>
            <Text style={[styles.quickSub, { color: theme.inkSoft }]}>{t("expenses.addManualSub")}</Text>
          </Pressable>
        </View>

        {/* Recent */}
        {data.sorted.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
            <Icon name="wallet" size={28} color={theme.inkMuted} />
            <Text style={[styles.emptyTitle, { color: theme.inkDeep }]}>{t("expenses.noExpensesTitle")}</Text>
            <Text style={[styles.emptyBody, { color: theme.inkSoft }]}>{t("expenses.noExpensesBody")}</Text>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("expenses.recent")}</Text>
              <Text style={[styles.sectionMeta, { color: theme.inkSoft }]}>
                {t("expenses.recentCount", { count: Math.min(data.sorted.length, 10) })}
              </Text>
            </View>
            <View style={styles.list}>
              {data.sorted.slice(0, 10).map((expense, index) => (
                <Animated.View key={expense.id} entering={FadeInDown.duration(200).delay(index * 30)}>
                  <ExpenseRow
                    expense={expense}
                    locale={locale}
                    theme={theme}
                    t={t}
                    formatCurrency={formatCurrency}
                    onPress={() => openEdit(expense)}
                  />
                </Animated.View>
              ))}
            </View>
          </>
        )}

        {/* Top merchants */}
        {data.merchants.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("expenses.topMerchants")}</Text>
            </View>
            <View style={[styles.card, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
              {data.merchants.map((merchant, index, all) => {
                const max = Math.max(...all.map((entry) => entry.amount));
                return (
                  <View key={merchant.merchant} style={{ marginBottom: index < all.length - 1 ? 12 : 0 }}>
                    <View style={styles.merchantRow}>
                      <Text style={[styles.merchantName, { color: theme.inkDeep }]} numberOfLines={1}>
                        {merchant.merchant}
                      </Text>
                      <Text style={[styles.merchantAmount, { color: theme.inkDeep }]}>
                        {formatCurrency(merchant.amount, currency, { maximumFractionDigits: 0 })}{" "}
                        <Text style={{ color: theme.inkMuted }}>
                          · {t("expenses.times", { count: merchant.count })}
                        </Text>
                      </Text>
                    </View>
                    <View style={[styles.merchantTrack, { backgroundColor: theme.hairline }]}>
                      <View
                        style={[
                          styles.merchantFill,
                          { width: `${max > 0 ? (merchant.amount / max) * 100 : 0}%`, backgroundColor: theme.teal },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={formOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setFormOpen(false)}>
        <SafeAreaView edges={["top"]} style={[styles.modalRoot, { backgroundColor: theme.paper }]}>
          <ExpenseForm
            editingExpense={editing}
            tripId={activeTrip?.id ?? null}
            tripCurrency={currency}
            companions={activeTrip?.mode === "group" ? activeTrip.companions : []}
            onSave={() => setFormOpen(false)}
            onCancel={() => setFormOpen(false)}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={importOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setImportOpen(false)}>
        <SafeAreaView edges={["top"]} style={[styles.modalRoot, { backgroundColor: theme.paper }]}>
          <ImportSheet
            tripId={activeTrip?.id ?? null}
            trip={activeTrip}
            onClose={() => setImportOpen(false)}
            onImported={() => setImportOpen(false)}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function SpendChart({
  values,
  budgetDaily,
  lineColor,
  budgetColor,
  gridColor,
}: {
  values: number[];
  budgetDaily: number;
  lineColor: string;
  budgetColor: string;
  gridColor: string;
}) {
  const width = 320;
  const height = 120;
  const max = Math.max(...values, budgetDaily, 1) * 1.15;
  const points = values.map((value, index) => {
    const x = 6 + (index / Math.max(1, values.length - 1)) * 308;
    const y = 114 - (value / max) * 108;
    return { x, y };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L314,114 L6,114 Z`;
  const budgetY = 114 - (budgetDaily / max) * 108;
  const last = points[points.length - 1];

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id="spendGrad" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
          <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {[0.25, 0.5, 0.75].map((tick) => (
        <Line
          key={tick}
          x1={6}
          x2={314}
          y1={6 + tick * 108}
          y2={6 + tick * 108}
          stroke={gridColor}
          strokeDasharray="2 4"
        />
      ))}
      <Line
        x1={6}
        x2={314}
        y1={budgetY}
        y2={budgetY}
        stroke={budgetColor}
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.75}
      />
      <Path d={areaPath} fill="url(#spendGrad)" />
      <Path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" />
      {last ? <Circle cx={last.x} cy={last.y} r={4} fill={lineColor} /> : null}
    </Svg>
  );
}

function ExpenseRow({
  expense,
  locale,
  theme,
  t,
  formatCurrency,
  onPress,
}: {
  expense: Expense;
  locale: string;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
  t: ReturnType<typeof useLocalization>["t"];
  formatCurrency: ReturnType<typeof useLocalization>["formatCurrency"];
  onPress: () => void;
}) {
  const meta = getCategoryMeta(expense.category);
  const color = theme[meta.color];
  const soft = theme[meta.soft];
  const sourceLabel =
    expense.source === "sms"
      ? t("expenses.sourceSms")
      : expense.source === "email"
        ? t("expenses.sourceEmail")
        : null;
  const dateLabel = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(expense.date));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.paperSoft, borderColor: theme.hairline, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: soft }]}>
        <Icon name={meta.icon} size={18} color={color} strokeWidth={1.7} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowMerchant, { color: theme.inkDeep }]} numberOfLines={1}>
          {expense.merchant}
        </Text>
        <View style={styles.rowMetaRow}>
          <Text style={[styles.rowCategory, { color }]}>{t(`expenses.category.${expense.category}`)}</Text>
          <Text style={{ color: theme.hairline }}>·</Text>
          <Text style={[styles.rowDate, { color: theme.inkSoft }]}>{dateLabel}</Text>
          {expense.location?.label ? (
            <>
              <Text style={{ color: theme.hairline }}>·</Text>
              <Icon name="mapPin" size={11} color={theme.inkMuted} />
            </>
          ) : null}
          {sourceLabel ? (
            <View style={[styles.sourceBadge, { backgroundColor: theme.skySoft }]}>
              <Text style={[styles.sourceText, { color: theme.sky }]}>{sourceLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text style={[styles.rowAmount, { color: theme.inkDeep }]}>
        {formatCurrency(expense.amount, expense.currency)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 120, gap: 14 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    paddingBottom: 2,
  },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  heroTitle: { fontFamily: NOMAD_FONTS.display, fontSize: 38, lineHeight: 40, marginTop: 4 },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  syncBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  syncBannerText: { flex: 1, fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  heroCard: { borderRadius: 22, padding: 20, gap: 18, overflow: "hidden" },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroTotalBlock: { flex: 1 },
  heroLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  heroAmount: { fontFamily: NOMAD_FONTS.display, fontSize: 44, lineHeight: 46, marginTop: 6 },
  heroSub: { fontFamily: NOMAD_FONTS.ui, fontSize: 12.5, marginTop: 6 },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  heroPillText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 11 },
  budgetBarWrap: { gap: 10 },
  budgetBar: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
    gap: 1.5,
  },
  legendRow: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  legendItem: { gap: 3 },
  legendTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 6, height: 6, borderRadius: 999 },
  legendLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  legendAmount: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16 },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  chartAvg: { fontFamily: NOMAD_FONTS.display, fontSize: 22, marginTop: 2 },
  chartAvgUnit: { fontFamily: NOMAD_FONTS.ui, fontSize: 13 },
  chartLegend: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendLine: { width: 8, height: 2 },
  legendTiny: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 9 },
  quickRow: { flexDirection: "row", gap: 10 },
  quickCard: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 },
  quickTitle: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14, marginTop: 6 },
  quickSub: { fontFamily: NOMAD_FONTS.ui, fontSize: 11.5 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  sectionMeta: { fontFamily: NOMAD_FONTS.mono, fontSize: 11 },
  list: { gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 3 },
  rowMerchant: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  rowMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowCategory: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  rowDate: { fontFamily: NOMAD_FONTS.ui, fontSize: 11 },
  sourceBadge: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  sourceText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 8.5,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  rowAmount: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 14 },
  merchantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 5,
  },
  merchantName: { flex: 1, fontFamily: NOMAD_FONTS.uiMedium, fontSize: 13 },
  merchantAmount: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 11.5 },
  merchantTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  merchantFill: { height: "100%" },
  emptyCard: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 18,
    padding: 28,
    gap: 10,
  },
  emptyTitle: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 16 },
  emptyBody: { fontFamily: NOMAD_FONTS.ui, fontSize: 13, lineHeight: 19, textAlign: "center" },
  modalRoot: { flex: 1 },
});
