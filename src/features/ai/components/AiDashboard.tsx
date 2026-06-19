import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { NOMAD_FONTS, type NomadColors } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { NomadButton } from "@/components/nomad/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { getCategoryMeta } from "@/features/expenses/constants/categories";
import { useTripExpenseSummary } from "@/features/expenses/hooks/useTripExpenseSummary";

interface Props {
  theme: NomadColors;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function countInclusiveDays(startDate: Date, endDate: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return Math.max(1, Math.round((end - start) / msPerDay) + 1);
}

function getTripProgress(trip: Trip) {
  const today = startOfLocalDay(new Date());
  const startDate = fromDateKey(trip.startDate);
  const endDate = fromDateKey(trip.endDate);
  const totalDays = countInclusiveDays(startDate, endDate);
  const elapsedDays = countInclusiveDays(startDate, today);

  if (today < startOfLocalDay(startDate)) {
    return { status: "upcoming" as const, day: 0, totalDays, percent: 0 };
  }
  if (today > startOfLocalDay(endDate)) {
    return { status: "complete" as const, day: totalDays, totalDays, percent: 100 };
  }
  return {
    status: "active" as const,
    day: Math.min(elapsedDays, totalDays),
    totalDays,
    percent: Math.min(100, (elapsedDays / totalDays) * 100),
  };
}

function DayBars({
  theme,
  data,
  formatAmount,
  height = 92,
}: {
  theme: NomadColors;
  data: { d: string; v: number; highlight?: boolean }[];
  formatAmount: (amount: number) => string;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.v));
  return (
    <View style={[styles.dayBars, { height }]}>
      {data.map((d, i) => {
        const pct = max > 0 ? d.v / max : 0;
        return (
          <View key={i} style={styles.dayColumn}>
            <Text style={[styles.dayValue, { color: theme.inkMuted }]}>{formatAmount(d.v)}</Text>
            <View
              style={{
                width: "100%",
                height: pct * (height - 30),
                backgroundColor: d.highlight ? theme.stamp : theme.teal,
                opacity: d.highlight ? 1 : 0.85,
                borderRadius: 4,
              }}
            />
            <Text style={[styles.dayLabel, { color: d.highlight ? theme.stamp : theme.inkMuted }]}>{d.d}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SpendChart({
  theme,
  data,
  budget,
  height = 140,
}: {
  theme: NomadColors;
  data: number[];
  budget: number;
  height?: number;
}) {
  const w = 320;
  const h = height;
  const pad = 8;
  const max = Math.max(...data, budget) * 1.15;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - 0) / (max - 0)) * (h - pad * 2);
  const linePath = data.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const areaPath = `${linePath} L${x(data.length - 1)},${h - pad} L${x(0)},${h - pad} Z`;
  const budgetY = y(budget);

  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={theme.teal} stopOpacity={0.22} />
          <Stop offset="100%" stopColor={theme.teal} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <Line
          key={t}
          x1={pad}
          x2={w - pad}
          y1={pad + t * (h - pad * 2)}
          y2={pad + t * (h - pad * 2)}
          stroke={theme.hairline}
          strokeDasharray="2 4"
        />
      ))}
      <Line x1={pad} x2={w - pad} y1={budgetY} y2={budgetY} stroke={theme.stamp} strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
      <Path d={areaPath} fill="url(#spendArea)" />
      <Path d={linePath} fill="none" stroke={theme.teal} strokeWidth={2} strokeLinejoin="round" />
      {data.map((v, i) => {
        const last = i === data.length - 1;
        return (
          <G key={i}>
            {last && <Circle cx={x(i)} cy={y(v)} r={8} fill={theme.teal} opacity={0.2} />}
            <Circle cx={x(i)} cy={y(v)} r={last ? 4 : 2.5} fill={theme.teal} />
            {last && <Circle cx={x(i)} cy={y(v)} r={1.5} fill="#fff" />}
          </G>
        );
      })}
    </Svg>
  );
}

function Donut({
  theme,
  data,
  total,
  size = 130,
}: {
  theme: NomadColors;
  data: { v: number; color: string }[];
  total: number;
  size?: number;
}) {
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={theme.hairline} strokeWidth={14} />
      {data.map((d, i) => {
        const frac = total > 0 ? d.v / total : 0;
        const dash = frac * c;
        const offset = -data.slice(0, i).reduce((sum, entry) => sum + entry.v / total, 0) * c;
        return (
          <Circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth={14}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
          />
        );
      })}
    </Svg>
  );
}

function InsightCard({
  theme,
  icon,
  label,
  value,
  sub,
  color = "teal",
}: {
  theme: NomadColors;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color?: "teal" | "stamp" | "mustard";
}) {
  const accent = theme[color];
  const accentSoft = theme[`${color}Soft`];
  return (
    <NomadCard theme={theme} style={{ flex: 1 }} padding={14}>
      <View style={[styles.insightIcon, { backgroundColor: accentSoft }]}>{icon}</View>
      <Text style={[styles.insightLabel, { color: theme.inkMuted }]}>{label}</Text>
      <Text style={[styles.insightValue, { color: theme.inkDeep }]}>{value}</Text>
      {sub ? <Text style={[styles.insightSub, { color: accent }]}>{sub}</Text> : null}
    </NomadCard>
  );
}

export function AiDashboard({ theme }: Props) {
  const router = useRouter();
  const { t, locale, formatCurrency, formatDate } = useLocalization();

  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? trips[0] ?? null;
  const expenseSummary = useTripExpenseSummary(activeTrip);

  const { progress, dailyBudget, totalDays, duration } = useMemo(() => {
    if (!activeTrip) {
      return { progress: null, dailyBudget: 0, totalDays: 0, duration: 0 };
    }
    const startDate = fromDateKey(activeTrip.startDate);
    const endDate = fromDateKey(activeTrip.endDate);
    const dur = countInclusiveDays(startDate, endDate);
    const prog = getTripProgress(activeTrip);
    const db = activeTrip.budget / dur;
    return { progress: prog, dailyBudget: db, totalDays: prog.totalDays, duration: dur };
  }, [activeTrip]);

  const actualSpent = expenseSummary.total;
  const remaining = Math.max(0, (activeTrip?.budget ?? 0) - actualSpent);
  const hasExpenseData = expenseSummary.convertedExpenses.length > 0;
  const dailyData = useMemo(() => {
    const values = new Map(expenseSummary.dailyTotals.map((entry) => [entry.date, entry.amount]));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return {
        d: new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(date),
        v: values.get(key) ?? 0,
        highlight: index === 6,
      };
    });
  }, [expenseSummary.dailyTotals, locale]);
  const todaySpent = dailyData.at(-1)?.v ?? 0;
  const spendPercent = activeTrip?.budget ? Math.round((actualSpent / activeTrip.budget) * 100) : 0;

  if (!activeTrip) {
    return (
      <EmptyState
        icon="analytics-outline"
        title={t("aiTab.emptyTitle")}
        description={t("aiTab.emptyBody")}
        action={{
          title: t("aiTab.createTripAction"),
          onPress: () => router.push("/(tabs)"),
        }}
      />
    );
  }

  const companionCount = activeTrip.mode === "group" ? activeTrip.companions.length + 1 : 1;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {/* Trip context card */}
      <View style={[styles.brief, { backgroundColor: theme.teal }]}>
        <View style={styles.briefHeader}>
          <View style={[styles.briefOrb, { backgroundColor: theme.paperSoft }]} />
          <Text style={[styles.briefEyebrow, { color: theme.inverse }]}>{t("aiTab.tripBrief")}</Text>
        </View>
        <Text style={[styles.briefHeadline, { color: theme.inverse }]}>{activeTrip.name}</Text>
        <Text style={[styles.briefBody, { color: theme.whiteText }]}>
          {formatDate(fromDateKey(activeTrip.startDate))} — {formatDate(fromDateKey(activeTrip.endDate))} ·{" "}
          {activeTrip.mode === "solo" ? t("aiTab.solo") : t("aiTab.groupWithCount", { count: companionCount })} ·{" "}
          {activeTrip.destinations.join(", ")}
        </Text>
        <View style={styles.briefStats}>
          <View style={styles.briefStat}>
            <Text style={[styles.briefStatLabel, { color: theme.whiteTextMuted }]}>{t("aiTab.budget")}</Text>
            <Text style={[styles.briefStatValue, { color: theme.inverse }]}>
              {formatCurrency(activeTrip.budget, activeTrip.currency)}
            </Text>
          </View>
          <View style={styles.briefStat}>
            <Text style={[styles.briefStatLabel, { color: theme.whiteTextMuted }]}>{t("aiTab.remaining")}</Text>
            <Text style={[styles.briefStatValue, { color: theme.inverse }]}>
              {formatCurrency(remaining, activeTrip.currency)}
            </Text>
          </View>
          <View style={styles.briefStat}>
            <Text style={[styles.briefStatLabel, { color: theme.whiteTextMuted }]}>{t("aiTab.dailyBudget")}</Text>
            <Text style={[styles.briefStatValue, { color: theme.inverse }]}>
              {formatCurrency(dailyBudget, activeTrip.currency)}
            </Text>
          </View>
        </View>
      </View>

      {/* Insight mini cards */}
      <View style={styles.miniRow}>
        <InsightCard
          theme={theme}
          icon={<Icon name="trendUp" size={18} color={theme.teal} strokeWidth={2} />}
          label={t("aiTab.tripProgress")}
          value={`${Math.round(progress?.percent ?? 0)}%`}
          sub={t("aiTab.dayProgress", { day: progress?.day ?? 0, total: totalDays })}
          color="teal"
        />
        <InsightCard
          theme={theme}
          icon={<Icon name="wallet" size={18} color={theme.mustard} strokeWidth={2} />}
          label={t("aiTab.actual")}
          value={formatCurrency(actualSpent, activeTrip.currency)}
          sub={t("aiTab.ofBudget", { total: formatCurrency(activeTrip.budget, activeTrip.currency) })}
          color="mustard"
        />
      </View>

      {hasExpenseData ? (
        <>
          <NomadCard theme={theme}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("aiTab.dailySpend")}</Text>
                <Text style={[styles.chartValue, { color: theme.inkDeep }]}>
                  {formatCurrency(todaySpent, activeTrip.currency)}{" "}
                  <Text style={[styles.chartValueSub, { color: theme.inkMuted }]}>{t("aiTab.today")}</Text>
                </Text>
              </View>
              <View style={styles.legend}>
                <View style={[styles.legendDot, { backgroundColor: theme.teal }]} />
                <Text style={[styles.legendText, { color: theme.inkSoft }]}>{t("aiTab.actual")}</Text>
                <View style={[styles.legendDot, { backgroundColor: theme.stamp }]} />
                <Text style={[styles.legendText, { color: theme.inkSoft }]}>{t("aiTab.budget")}</Text>
              </View>
            </View>
            <SpendChart theme={theme} data={dailyData.map((entry) => entry.v)} budget={dailyBudget} />
          </NomadCard>

          <NomadCard theme={theme}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted, marginBottom: 10 }]}>{t("aiTab.whereMoneyGoes")}</Text>
            <View style={styles.donutRow}>
              <Donut
                theme={theme}
                data={expenseSummary.categoryTotals.map((entry) => ({
                  v: entry.amount,
                  color: theme[getCategoryMeta(entry.category).color],
                }))}
                total={actualSpent}
              />
              <View style={styles.categoryList}>
                {expenseSummary.categoryTotals.map((entry) => {
                  const color = theme[getCategoryMeta(entry.category).color];
                  const percent = actualSpent > 0 ? Math.round((entry.amount / actualSpent) * 100) : 0;
                  return (
                    <View key={entry.category} style={styles.categoryRow}>
                      <View style={[styles.categoryDot, { backgroundColor: color }]} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.categoryTop}>
                          <Text style={[styles.categoryName, { color: theme.inkDeep }]}>{t(`expenses.category.${entry.category}`)}</Text>
                          <Text style={[styles.categoryValue, { color: theme.inkDeep }]}>{formatCurrency(entry.amount, activeTrip.currency)}</Text>
                        </View>
                        <Text style={[styles.categoryPct, { color: theme.inkMuted }]}>{percent}% {t("aiTab.ofTotal")}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </NomadCard>

          <NomadCard theme={theme}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("aiTab.byDay")}</Text>
                <Text style={[styles.chartCaption, { color: theme.inkSoft }]}>{t("aiTab.byDayCaption", { percent: spendPercent })}</Text>
              </View>
            </View>
            <DayBars
              theme={theme}
              data={dailyData}
              formatAmount={(amount) => formatCurrency(amount, activeTrip.currency, { maximumFractionDigits: 0 })}
            />
          </NomadCard>
        </>
      ) : (
        <NomadCard theme={theme} style={{ alignItems: "center", paddingVertical: 28 }}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.tealSoft }]}>
            <Icon name="receipt" size={28} color={theme.teal} strokeWidth={2} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.inkDeep }]}>{t("aiTab.noExpensesTitle")}</Text>
          <Text style={[styles.emptyBody, { color: theme.inkSoft }]}>{t("aiTab.noExpensesBody")}</Text>
          <NomadButton variant="teal" theme={theme} onPress={() => router.push("/(tabs)/expenses")}>
            {t("aiTab.logExpense")}
          </NomadButton>
        </NomadCard>
      )}

      {/* Forecast — derived from trip budget, no hardcoded numbers */}
      <NomadCard theme={theme} style={{ backgroundColor: theme.tealSoft, borderColor: `${theme.teal}66` }}>
        <View style={styles.forecastHeader}>
          <View style={[styles.forecastIcon, { backgroundColor: theme.teal }]}>
            <Icon name="trendUp" size={16} color={theme.inverse} strokeWidth={2} />
          </View>
          <Text style={[styles.sectionLabel, { color: theme.teal }]}>{t("aiTab.onDeviceForecast")}</Text>
        </View>
        <Text style={[styles.forecastHeadline, { color: theme.inkDeep }]}>
          {t("aiTab.forecastBody", {
            remaining: formatCurrency(remaining, activeTrip.currency),
            daysLeft: Math.max(0, duration - (progress?.day ?? 0)),
          })}
        </Text>
        <Text style={[styles.forecastSub, { color: theme.inkSoft }]}>{t("aiTab.forecastHint")}</Text>
      </NomadCard>

      <View style={styles.footer}>
        <Icon name="lock" size={12} color={theme.inkMuted} strokeWidth={2} />
        <Text style={[styles.footerText, { color: theme.inkMuted }]}>{t("aiTab.analysisFooter")}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 120, gap: 14 },
  brief: { borderRadius: 20, padding: 18, overflow: "hidden" },
  briefHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  briefOrb: { width: 14, height: 14, borderRadius: 999 },
  briefEyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    opacity: 0.9,
  },
  briefHeadline: { fontFamily: NOMAD_FONTS.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.4 },
  briefBody: { fontFamily: NOMAD_FONTS.ui, fontSize: 12, marginTop: 8, lineHeight: 18, opacity: 0.9 },
  briefStats: {
    flexDirection: "row",
    gap: 14,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.18)",
  },
  briefStat: { flex: 1 },
  briefStatLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    opacity: 0.7,
  },
  briefStatValue: { fontFamily: NOMAD_FONTS.display, fontSize: 22, marginTop: 2, letterSpacing: -0.3 },
  miniRow: { flexDirection: "row", gap: 12 },
  insightIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  insightLabel: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" },
  insightValue: { fontFamily: NOMAD_FONTS.display, fontSize: 24, marginTop: 4, lineHeight: 28 },
  insightSub: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 11, marginTop: 4 },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  sectionLabel: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase" },
  chartValue: { fontFamily: NOMAD_FONTS.display, fontSize: 22, marginTop: 2, lineHeight: 24 },
  chartValueSub: { fontFamily: NOMAD_FONTS.displayItalic, fontSize: 14 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 2 },
  legendText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 10, letterSpacing: 0.3 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 18 },
  categoryList: { flex: 1, gap: 8 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  categoryDot: { width: 8, height: 8, borderRadius: 2 },
  categoryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  categoryName: { fontFamily: NOMAD_FONTS.ui, fontSize: 12 },
  categoryValue: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 11 },
  categoryPct: { fontFamily: NOMAD_FONTS.ui, fontSize: 9 },
  dayBars: { flexDirection: "row", alignItems: "flex-end", gap: 6, paddingTop: 10 },
  dayColumn: { flex: 1, alignItems: "center", gap: 4 },
  dayValue: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 9 },
  dayLabel: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 10, letterSpacing: 0.4 },
  chartCaption: { fontSize: 12, marginTop: 4, marginBottom: 2, lineHeight: 16 },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { fontFamily: NOMAD_FONTS.display, fontSize: 22, textAlign: "center" },
  emptyBody: { fontFamily: NOMAD_FONTS.ui, fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 6, marginBottom: 16 },
  forecastHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  forecastIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  forecastHeadline: { fontFamily: NOMAD_FONTS.display, fontSize: 18, lineHeight: 22 },
  forecastSub: { fontFamily: NOMAD_FONTS.ui, fontSize: 12, marginTop: 8, lineHeight: 18 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 4, marginTop: 4 },
  footerText: { fontFamily: NOMAD_FONTS.mono, fontSize: 10, letterSpacing: 0.5 },
});
