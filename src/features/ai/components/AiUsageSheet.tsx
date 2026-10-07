import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraCard, AuraListGroup, AuraListRow, AuraProgressBar, AuraSheet, AuraSkeleton, AuraSkeletonGroup, useAura } from "@/atoms";
import { auraStatusColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { api, useQuery } from "@/modules/backend";
import { usePlan } from "@/modules/billing";
import { byokProviderName, useAiUsageLog, useByokStore, type AiTask, type AiTaskCounts } from "@/modules/ai";

type UsageTask = Exclude<AiTask, "expenseCategory">;
type Translate = ReturnType<typeof useLocalization>["t"];

const USAGE_TASKS: UsageTask[] = ["chat", "chatSummary", "tripBudget", "tripName", "itinerary", "voiceExpense"];
const [INDIGO, TEAL] = auraStatusColors.calm;
const DAY_MS = 24 * 60 * 60 * 1000;

function isUsageTask(task: AiTask): task is UsageTask {
  return (USAGE_TASKS as AiTask[]).includes(task);
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatWhen(at: number, now: number, locale: string, hour12: boolean, t: Translate): string {
  const today = startOfDay(now);
  try {
    if (at >= today) return new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12 });
    if (at >= today - DAY_MS) return t("aiUsage.yesterday");
    return new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch {
    return new Date(at).toLocaleDateString();
  }
}

/** The allowance resets at 00:00 UTC, so the date is shown in UTC. */
function formatResetDate(ms: number, locale: string): string {
  try {
    return new Date(ms).toLocaleDateString(locale, { month: "long", day: "numeric", timeZone: "UTC" });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function FeatureCounts({ title, counts, footer }: { title: string; counts: AiTaskCounts; footer?: string }) {
  const { t } = useLocalization();
  const used = USAGE_TASKS.filter((task) => (counts[task] ?? 0) > 0);
  return (
    <AuraListGroup title={title} footer={footer}>
      {used.length === 0 ? (
        <AuraListRow label={t("aiUsage.noneYet")} />
      ) : (
        used.map((task) => <AuraListRow key={task} label={t(`aiUsage.feature_${task}`)} value={String(counts[task])} />)
      )}
    </AuraListGroup>
  );
}

/** This month's online AI use: the NomadSafe Cloud allowance (Pro), own-key counts, and recent uses on this phone. */
export function AiUsageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const plan = usePlan();
  const byok = useByokStore((s) => s.summary);
  const usage = useQuery(api.ai.myUsage, visible && plan.cloudAi ? {} : "skip");
  const log = useAiUsageLog();
  const [now] = useState(Date.now);

  const providerName = byok ? byokProviderName(byok) : null;
  const byokLabel = providerName ? t("aiSource.byok", { provider: providerName }) : t("aiUsage.yourKey");
  const recent = log.recent.filter((entry) => isUsageTask(entry.task));

  const meter = (label: string, used: number, limit: number, tone: string) => (
    <View style={styles.meter}>
      <View style={styles.meterHead}>
        <Text numberOfLines={1} style={[styles.meterLabel, { color: c.text, fontFamily: f.medium }]}>{label}</Text>
        <Text style={[styles.meterValue, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiUsage.usedOfLimit", { used, limit })}</Text>
      </View>
      <AuraProgressBar value={limit > 0 ? used / limit : 0} tone={tone} accessibilityLabel={label} />
    </View>
  );

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={plan.cloudAi ? t("settings.cloudAiUsage") : t("settings.aiUsageTitle")}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {plan.cloudAi ? (
          <>
            <Text style={[styles.sectionTitle, { color: c.textMuted, fontFamily: f.medium }]}>{t("aiUsage.cloudSection")}</Text>
            <AuraCard style={styles.card}>
              {usage === undefined ? (
                <AuraSkeletonGroup label={t("aiUsage.cloudLoading")} style={styles.card}>
                  {[0, 1].map((i) => (
                    <View key={i} style={styles.meter}>
                      <View style={styles.meterHead}>
                        <AuraSkeleton width="40%" height={14} />
                        <AuraSkeleton width={64} height={12} radius={6} />
                      </View>
                      <AuraSkeleton height={8} radius={4} />
                    </View>
                  ))}
                  <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiUsage.cloudLoading")}</Text>
                </AuraSkeletonGroup>
              ) : usage === null ? (
                <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiUsage.cloudSignedOut")}</Text>
              ) : (
                <>
                  {meter(t("aiUsage.chatReplies"), usage.chat.used, usage.chat.limit, INDIGO)}
                  {meter(t("aiUsage.otherTasks"), usage.tasks.used, usage.tasks.limit, TEAL)}
                  <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>
                    {t("aiUsage.resetsOn", { date: formatResetDate(usage.resetsAt, locale) })}
                  </Text>
                </>
              )}
            </AuraCard>
            {usage ? <FeatureCounts title={t("aiUsage.cloudByFeature")} counts={usage.byTask} /> : null}
          </>
        ) : null}

        {byok && providerName ? (
          <FeatureCounts title={byokLabel} counts={log.byokCountsByTask} footer={t("aiUsage.byokNote", { provider: providerName })} />
        ) : null}

        <AuraListGroup title={t("aiUsage.recent")}>
          {recent.length === 0 ? (
            <AuraListRow label={t("aiUsage.recentEmpty")} />
          ) : (
            recent.map((entry) => (
              <AuraListRow
                key={`${entry.at}-${entry.task}`}
                label={t(`aiUsage.use_${entry.task as UsageTask}`)}
                detail={entry.provider === "cloud" ? t("aiTab.cloudName") : byokLabel}
                value={formatWhen(entry.at, now, locale, hour12, t)}
              />
            ))
          )}
        </AuraListGroup>

        <Text style={[styles.privacy, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiUsage.privacy")}</Text>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 16 },
  sectionTitle: { fontSize: 13, marginTop: 8, marginBottom: 8, marginLeft: 4 },
  card: { gap: 14 },
  meter: { gap: 8 },
  meterHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  meterLabel: { flexShrink: 1, fontSize: 15 },
  meterValue: { fontSize: 13.5 },
  note: { fontSize: 12.5, lineHeight: 18 },
  privacy: { fontSize: 12.5, lineHeight: 18, marginTop: 18, marginHorizontal: 4 },
});
