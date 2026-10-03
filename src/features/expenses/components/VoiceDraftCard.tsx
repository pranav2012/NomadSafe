import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
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
  const { nomad } = useTheme();
  const theme = nomad.colors;
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

  return (
    <Pressable
      onPress={pause}
      style={[styles.card, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}
    >
      <Text style={[styles.transcript, { color: theme.inkSoft }]}>“{draft.transcript}”</Text>

      {draft.kind === "expense" ? (
        <>
          <View style={styles.amountRow}>
            <Text style={[styles.amount, { color: theme.inkDeep }]}>{amount}</Text>
            <View style={[styles.categoryPill, { backgroundColor: theme[getCategoryMeta(draft.category).soft] }]}>
              <Icon
                name={getCategoryMeta(draft.category).icon}
                size={13}
                color={theme[getCategoryMeta(draft.category).color]}
              />
              <Text style={[styles.categoryText, { color: theme.inkDeep }]}>
                {t(`expenses.category.${draft.category}`)}
              </Text>
            </View>
          </View>
          <Text style={[styles.meta, { color: theme.inkDeep }]}>
            {draft.merchant || t(`expenses.category.${draft.category}`)}
          </Text>
          <Text style={[styles.metaSoft, { color: theme.inkSoft }]}>
            {[tripName, dateLabel, t("split.paidByName", { name: personLabel(draft.paidBy, t) })]
              .filter(Boolean)
              .join(" · ")}
          </Text>

          {shares?.ok ? (
            <View style={[styles.shares, { borderColor: theme.hairline }]}>
              {shares.shares.map((share) => (
                <View key={share.person} style={styles.shareRow}>
                  <Text style={[styles.shareName, { color: theme.inkDeep }]}>{personLabel(share.person, t)}</Text>
                  <Text style={[styles.shareAmount, { color: theme.inkDeep }]}>
                    {formatMoney(formatCurrency, share.amount, draft.currency)}
                  </Text>
                </View>
              ))}
            </View>
          ) : shares === null ? (
            <Text style={[styles.metaSoft, { color: theme.inkSoft }]}>{t("split.notSplit")}</Text>
          ) : (
            <Text style={[styles.warning, { color: theme.stamp }]}>{t(`split.invalid.${shares.reason}`)}</Text>
          )}
        </>
      ) : (
        <>
          <Text style={[styles.amount, { color: theme.inkDeep }]}>{amount}</Text>
          <Text style={[styles.meta, { color: theme.inkDeep }]}>
            {t("split.paid", { from: personLabel(draft.from, t), to: personLabel(draft.to, t) })}
          </Text>
          <Text style={[styles.metaSoft, { color: theme.inkSoft }]}>
            {[tripName ?? t("voiceExpense.repaymentNeedsTrip"), dateLabel].join(" · ")}
          </Text>
        </>
      )}

      {draft.amountUncertain ? (
        <View style={[styles.notice, { backgroundColor: theme.mustardSoft }]}>
          <Icon name="alertTriangle" size={15} color={theme.stamp} />
          <Text style={[styles.noticeText, { color: theme.inkDeep }]}>{t("voiceExpense.checkAmount")}</Text>
        </View>
      ) : null}

      {draft.unknownNames.map((name) => (
        <View key={name} style={[styles.notice, { backgroundColor: theme.mustardSoft }]}>
          <Icon name="users" size={15} color={theme.stamp} />
          <Text style={[styles.noticeText, { color: theme.inkDeep }]}>{t("voiceExpense.notOnTrip", { name })}</Text>
          {canAddPeople ? (
            <Pressable onPress={() => onAddPerson(name)} hitSlop={6}>
              <Text style={[styles.noticeAction, { color: theme.teal }]}>{t("voiceExpense.addToTrip")}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => onLeaveOut(name)} hitSlop={6}>
            <Text style={[styles.noticeAction, { color: theme.stamp }]}>{t("voiceExpense.leaveOut")}</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.actions}>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.secondary, { borderColor: theme.hairline, opacity: pressed ? 0.8 : 1 }]}
        >
          <Icon name="mic" size={15} color={theme.inkSoft} />
          <Text style={[styles.secondaryText, { color: theme.inkSoft }]}>{t("voiceExpense.retry")}</Text>
        </Pressable>
        {onEdit ? (
          <Pressable
            onPress={onEdit}
            style={({ pressed }) => [styles.secondary, { borderColor: theme.hairline, opacity: pressed ? 0.8 : 1 }]}
          >
            <Icon name="edit" size={15} color={theme.inkSoft} />
            <Text style={[styles.secondaryText, { color: theme.inkSoft }]}>{t("voiceExpense.edit")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          disabled={needsReview}
          onPress={() => onSave(false)}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: theme.teal, opacity: needsReview ? 0.45 : pressed ? 0.9 : 1 },
          ]}
        >
          <Icon name="check" size={16} color={theme.inverse} />
          <Text style={[styles.primaryText, { color: theme.inverse }]}>
            {counting ? t("voiceExpense.savingIn", { count: secondsLeft }) : t("voiceExpense.save")}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 10 },
  transcript: { fontFamily: NOMAD_FONTS.ui, fontSize: 13.5, fontStyle: "italic", lineHeight: 19 },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  amount: { fontFamily: NOMAD_FONTS.display, fontSize: 38, lineHeight: 42 },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 12 },
  meta: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 16 },
  metaSoft: { fontFamily: NOMAD_FONTS.ui, fontSize: 12.5 },
  shares: { borderTopWidth: 1, paddingTop: 10, gap: 6 },
  shareRow: { flexDirection: "row", justifyContent: "space-between" },
  shareName: { fontFamily: NOMAD_FONTS.uiMedium, fontSize: 14 },
  shareAmount: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 14 },
  warning: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: { flex: 1, fontFamily: NOMAD_FONTS.uiMedium, fontSize: 13 },
  noticeAction: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 13 },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  secondaryText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  primary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    paddingVertical: 12,
  },
  primaryText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
});
