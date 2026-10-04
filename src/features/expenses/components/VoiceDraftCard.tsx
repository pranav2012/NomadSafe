import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, useAura } from "@/atoms";
import { auraCategoryColors, auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { getCategoryMeta } from "@/features/expenses/constants/categories";
import { personLabel } from "@/features/expenses/components/SplitEditor";
import { formatMoney } from "@/features/expenses/utils/money";
import type { ShareResolution } from "@/features/expenses/utils/split";
import type { VoiceExpenseDraft, VoiceSettlementDraft } from "@/features/expenses/services/voiceExpense";

export const AUTO_SAVE_SECONDS = 6;

export interface VoiceDraftCardProps {
  draft: VoiceExpenseDraft | VoiceSettlementDraft;
  shares: ShareResolution | null;
  tripName: string | null;
  canAddPeople: boolean;
  onAddPerson: (name: string) => void;
  onLeaveOut: (name: string) => void;
  onSave: (auto: boolean) => void;
  onEdit?: () => void;
  onRetry: () => void;
}

/** Review card for a spoken draft; counts down to auto-save only when nothing needs checking. */
export function VoiceDraftCard({
  draft,
  shares,
  tripName,
  canAddPeople,
  onAddPerson,
  onLeaveOut,
  onSave,
  onEdit,
  onRetry,
}: VoiceDraftCardProps) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const [paused, setPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_SAVE_SECONDS);

  const invalidShares = shares !== null && !shares.ok;
  const invalidSettlement = draft.kind === "settlement" && (!tripName || draft.from === draft.to);
  const needsReview = draft.unknownNames.length > 0 || draft.amountUncertain || invalidShares || invalidSettlement;
  const counting = !needsReview && !paused;

  useEffect(() => {
    if (!counting) return;
    if (secondsLeft <= 0) {
      onSave(true);
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [counting, secondsLeft, onSave]);

  const pause = () => setPaused(true);
  const amount = formatMoney(formatCurrency, draft.amount, draft.currency);
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(draft.date),
  );
  const tone = draft.kind === "expense" ? auraCategoryColors[draft.category] : c.textSoft;

  return (
    <Pressable onPress={pause} style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}>
      <View style={[styles.highlight, { backgroundColor: c.highlight }]} />
      {draft.kind === "expense" ? (
        <>
          <View style={styles.amountRow}>
            <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>{amount}</Text>
            <View style={[styles.categoryPill, { backgroundColor: `${tone}1F` }]}>
              <Icon name={getCategoryMeta(draft.category).icon} size={13} color={tone} />
              <Text style={[styles.categoryText, { color: c.text, fontFamily: f.medium }]}>{t(`expenses.category.${draft.category}`)}</Text>
            </View>
          </View>
          <Text style={[styles.merchant, { color: c.text, fontFamily: f.medium }]}>
            {draft.merchant || t(`expenses.category.${draft.category}`)}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]}>
            {[tripName, dateLabel, t("split.paidByName", { name: personLabel(draft.paidBy, t) })].filter(Boolean).join(" · ")}
          </Text>

          {shares?.ok ? (
            <View style={[styles.shares, { borderColor: c.hairline }]}>
              {shares.shares.map((share) => (
                <View key={share.person} style={styles.shareRow}>
                  <Text style={[styles.shareText, { color: c.textSoft, fontFamily: f.regular }]}>{personLabel(share.person, t)}</Text>
                  <Text style={[styles.shareText, { color: c.text, fontFamily: f.medium }]}>
                    {formatMoney(formatCurrency, share.amount, draft.currency)}
                  </Text>
                </View>
              ))}
            </View>
          ) : shares === null ? (
            <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]}>{t("split.notSplit")}</Text>
          ) : (
            <Text style={[styles.warning, { fontFamily: f.medium }]}>{t(`split.invalid.${shares.reason}`)}</Text>
          )}
        </>
      ) : (
        <>
          <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>{amount}</Text>
          <Text style={[styles.merchant, { color: c.text, fontFamily: f.medium }]}>
            {t("split.paid", { from: personLabel(draft.from, t), to: personLabel(draft.to, t) })}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]}>
            {[tripName ?? t("voiceExpense.repaymentNeedsTrip"), dateLabel].join(" · ")}
          </Text>
        </>
      )}

      {draft.amountUncertain ? (
        <View style={[styles.notice, { backgroundColor: `${auraStatusAccent.live}1F` }]}>
          <Icon name="alertTriangle" size={15} color={auraStatusAccent.live} />
          <Text style={[styles.noticeText, { color: c.text, fontFamily: f.regular }]}>{t("voiceExpense.checkAmount")}</Text>
        </View>
      ) : null}

      {draft.unknownNames.map((name) => (
        <View key={name} style={[styles.notice, { backgroundColor: `${auraStatusAccent.live}1F` }]}>
          <Icon name="users" size={15} color={auraStatusAccent.live} />
          <Text style={[styles.noticeText, { color: c.text, fontFamily: f.regular }]}>{t("voiceExpense.notOnTrip", { name })}</Text>
          {canAddPeople ? (
            <PressableScale onPress={() => onAddPerson(name)} hitSlop={6} accessibilityRole="button">
              <Text style={[styles.noticeAction, { color: c.text, fontFamily: f.semibold }]}>{t("voiceExpense.addToTrip")}</Text>
            </PressableScale>
          ) : null}
          <PressableScale onPress={() => onLeaveOut(name)} hitSlop={6} accessibilityRole="button">
            <Text style={[styles.noticeAction, { color: c.textSoft, fontFamily: f.semibold }]}>{t("voiceExpense.leaveOut")}</Text>
          </PressableScale>
        </View>
      ))}

      <View style={styles.actions}>
        <PressableScale onPress={onRetry} accessibilityRole="button" accessibilityLabel={t("voiceExpense.retry")} style={[styles.round, { backgroundColor: c.surfaceStrong }]}>
          <Icon name="mic" size={17} color={c.text} />
        </PressableScale>
        {onEdit ? (
          <PressableScale onPress={onEdit} accessibilityRole="button" accessibilityLabel={t("voiceExpense.edit")} style={[styles.round, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="edit" size={16} color={c.text} />
          </PressableScale>
        ) : null}
        <AuraButton
          label={counting ? t("voiceExpense.savingIn", { count: secondsLeft }) : t("voiceExpense.save")}
          icon="check"
          disabled={needsReview}
          onPress={() => onSave(false)}
          style={styles.flex}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 26, padding: 18, gap: 8, overflow: "hidden" },
  highlight: { position: "absolute", top: 0, left: 28, right: 28, height: StyleSheet.hairlineWidth },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  amount: { fontSize: 38, letterSpacing: -1.2 },
  categoryPill: { flexDirection: "row", alignItems: "center", gap: 5, height: 28, borderRadius: 14, paddingHorizontal: 10 },
  categoryText: { fontSize: 12.5 },
  merchant: { fontSize: 16.5 },
  meta: { fontSize: 13 },
  shares: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4, gap: 6 },
  shareRow: { flexDirection: "row", justifyContent: "space-between" },
  shareText: { fontSize: 14, fontVariant: ["tabular-nums"] },
  warning: { color: auraStatusAccent.alert, fontSize: 13 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  noticeText: { flex: 1, fontSize: 13 },
  noticeAction: { fontSize: 13 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  round: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
});
