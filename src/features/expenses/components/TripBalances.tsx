import React, { useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { track } from "@/services/analytics";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { personLabel } from "@/features/expenses/components/SplitEditor";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { formatMoney } from "@/features/expenses/utils/money";
import { localeDecimalSeparator, parseAmountInput } from "@/features/expenses/utils/amountInput";
import {
  computeNetBalances,
  isSplitExpense,
  roundMoney,
  SELF_ID,
  simplifyDebts,
  type Transfer,
} from "@/features/expenses/utils/split";

const rateKey = (currency: string, date: string) => `${currency}|${toLocalDayKey(date)}`;

/** Who owes whom on a trip, in the trip currency, with settle-up actions. */
export function TripBalances({ trip }: { trip: Trip }) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale, formatCurrency } = useLocalization();
  const allExpenses = useExpensesStore((state) => state.expenses);
  const allSettlements = useExpensesStore((state) => state.settlements);
  const deleteSettlement = useExpensesStore((state) => state.deleteSettlement);
  const [settling, setSettling] = useState<Transfer | null>(null);

  const splitExpenses = useMemo(
    () => allExpenses.filter((expense) => expense.tripId === trip.id && isSplitExpense(expense)),
    [allExpenses, trip.id],
  );
  const settlements = useMemo(
    () => allSettlements.filter((settlement) => settlement.tripId === trip.id),
    [allSettlements, trip.id],
  );
  const convertedExpenses = useConvertedExpenses(splitExpenses, trip.currency);
  const convertedSettlements = useConvertedExpenses(settlements, trip.currency);

  const rates = new Map<string, number>();
  for (const entry of [...convertedExpenses.convertedExpenses, ...convertedSettlements.convertedExpenses]) {
    if (entry.expense.amount > 0) {
      rates.set(rateKey(entry.expense.currency, entry.expense.date), entry.amount / entry.expense.amount);
    }
  }
  const { net, unconverted } = computeNetBalances(splitExpenses, settlements, (_, currency, date) =>
    currency === trip.currency ? 1 : rates.get(rateKey(currency, date)) ?? null,
  );
  const transfers = simplifyDebts(net, trip.currency);
  const myNet = roundMoney(net.get(SELF_ID) ?? 0, trip.currency);

  if (splitExpenses.length === 0 && settlements.length === 0) return null;

  const money = (amount: number) => formatMoney(formatCurrency, amount, trip.currency);
  const everyone = [...new Set([SELF_ID, ...trip.companions, ...net.keys()])];

  const confirmDelete = (id: string) =>
    Alert.alert(t("split.deletePaymentTitle"), t("split.deletePaymentBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => deleteSettlement(id) },
    ]);

  return (
    <View style={[styles.card, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("split.balances")}</Text>
          <Text style={[styles.position, { color: myNet < 0 ? theme.stamp : theme.inkDeep }]}>
            {myNet > 0
              ? t("split.youAreOwed", { amount: money(myNet) })
              : myNet < 0
                ? t("split.youOwe", { amount: money(-myNet) })
                : t("split.settled")}
          </Text>
        </View>
        <Pressable
          onPress={() => setSettling({ from: trip.companions[0] ?? SELF_ID, to: SELF_ID, amount: 0 })}
          hitSlop={8}
          style={({ pressed }) => [styles.smallButton, { borderColor: theme.hairline, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.smallButtonText, { color: theme.teal }]}>{t("split.recordPayment")}</Text>
        </Pressable>
      </View>

      {transfers.map((transfer) => (
        <View key={`${transfer.from}->${transfer.to}`} style={[styles.row, { borderColor: theme.hairline }]}>
          <View style={styles.flex}>
            <Text style={[styles.rowTitle, { color: theme.inkDeep }]}>
              {t("split.owes", { from: personLabel(transfer.from, t), to: personLabel(transfer.to, t) })}
            </Text>
            <Text style={[styles.rowAmount, { color: theme.inkDeep }]}>{money(transfer.amount)}</Text>
          </View>
          <Pressable
            onPress={() => setSettling(transfer)}
            style={({ pressed }) => [styles.settleButton, { backgroundColor: theme.tealSoft, opacity: pressed ? 0.85 : 1 }]}
          >
            <Icon name="check" size={14} color={theme.teal} strokeWidth={2.2} />
            <Text style={[styles.settleText, { color: theme.teal }]}>{t("split.settle")}</Text>
          </Pressable>
        </View>
      ))}

      {unconverted > 0 ? (
        <Text style={[styles.note, { color: theme.inkSoft }]}>{t("split.unconverted", { count: unconverted })}</Text>
      ) : null}

      {settlements.length > 0 ? (
        <View style={styles.payments}>
          <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("split.payments")}</Text>
          {settlements.slice(0, 5).map((settlement) => (
            <Pressable key={settlement.id} onLongPress={() => confirmDelete(settlement.id)} style={styles.paymentRow}>
              <Text style={[styles.paymentText, { color: theme.inkSoft }]} numberOfLines={1}>
                {t("split.paid", { from: personLabel(settlement.from, t), to: personLabel(settlement.to, t) })}
                {" · "}
                {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(settlement.date))}
              </Text>
              <Text style={[styles.paymentAmount, { color: theme.inkDeep }]}>
                {formatMoney(formatCurrency, settlement.amount, settlement.currency)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Modal
        visible={settling !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSettling(null)}
      >
        {settling ? (
          <SettleUpSheet
            trip={trip}
            everyone={everyone}
            initial={settling}
            onClose={() => setSettling(null)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function SettleUpSheet({
  trip,
  everyone,
  initial,
  onClose,
}: {
  trip: Trip;
  everyone: string[];
  initial: Transfer;
  onClose: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();
  const addSettlement = useExpensesStore((state) => state.addSettlement);
  const decimalSeparator = localeDecimalSeparator(locale);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [amount, setAmount] = useState(initial.amount > 0 ? String(initial.amount).replace(".", decimalSeparator) : "");

  const save = () => {
    const value = parseAmountInput(amount, decimalSeparator);
    if (!Number.isFinite(value) || value <= 0 || from === to) {
      Alert.alert(t("expenses.validationTitle"), t("split.paymentValidation"));
      return;
    }
    addSettlement({
      tripId: trip.id,
      from,
      to,
      amount: value,
      currency: trip.currency,
      date: new Date().toISOString(),
      source: "manual",
    });
    track("settlement_recorded", { source: "manual" });
    onClose();
  };

  const picker = (label: string, selected: string, onSelect: (person: string) => void) => (
    <View style={styles.group}>
      <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{label}</Text>
      <View style={styles.chips}>
        {everyone.map((person) => {
          const active = person === selected;
          return (
            <Pressable
              key={person}
              onPress={() => onSelect(person)}
              style={[
                styles.chip,
                { backgroundColor: active ? theme.tealSoft : theme.paper, borderColor: active ? theme.teal : theme.hairline },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? theme.inkDeep : theme.inkSoft }]}>
                {personLabel(person, t)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={[styles.sheet, { backgroundColor: theme.paper }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.sheetTitle, { color: theme.inkDeep }]}>{t("split.recordPayment")}</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Icon name="x" size={20} color={theme.inkSoft} />
        </Pressable>
      </View>
      {picker(t("split.whoPaid"), from, setFrom)}
      {picker(t("split.whoReceived"), to, setTo)}
      <View style={styles.group}>
        <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>
          {t("expenses.amount")} · {trip.currency}
        </Text>
        <TextInput
          value={amount}
          onChangeText={(value) => setAmount(value.replace(/[^0-9.,]/g, ""))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={theme.inkMuted}
          style={[styles.amountInput, { color: theme.inkDeep, borderColor: theme.hairline, backgroundColor: theme.paperSoft }]}
        />
      </View>
      <Pressable
        onPress={save}
        style={({ pressed }) => [styles.saveButton, { backgroundColor: theme.teal, opacity: pressed ? 0.9 : 1 }]}
      >
        <Text style={[styles.saveText, { color: theme.inverse }]}>{t("split.savePayment")}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  position: { fontFamily: NOMAD_FONTS.display, fontSize: 22, marginTop: 2 },
  smallButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  smallButtonText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 12.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 12 },
  rowTitle: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  rowAmount: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 13, marginTop: 2 },
  settleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  settleText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  note: { fontFamily: NOMAD_FONTS.ui, fontSize: 12 },
  payments: { gap: 6 },
  paymentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  paymentText: { flex: 1, fontFamily: NOMAD_FONTS.ui, fontSize: 12.5 },
  paymentAmount: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 12.5 },
  sheet: { flex: 1, padding: 20, gap: 18 },
  sheetTitle: { fontFamily: NOMAD_FONTS.display, fontSize: 26 },
  group: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  amountInput: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 52,
    paddingHorizontal: 14,
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 22,
  },
  saveButton: { alignItems: "center", borderRadius: 18, paddingVertical: 16 },
  saveText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 15 },
});
