import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AuraButton,
  AuraCard,
  AuraChip,
  AuraField,
  AuraSection,
  AuraSheet,
  PressableScale,
  showAlert,
  useAura,
} from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { showInterstitial } from "@/modules/ads";
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

const OWED = "#3DDC97";
const OWES = auraStatusAccent.alert;

const rateKey = (currency: string, date: string) => `${currency}|${toLocalDayKey(date)}`;

/** Who owes whom on a trip, in the trip currency: net balance per person, settle-ups and payments. */
export function TripBalances({ trip }: { trip: Trip }) {
  const { c, f } = useAura();
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
  const money = (amount: number) => formatMoney(formatCurrency, amount, trip.currency);
  const everyone = [...new Set([SELF_ID, ...trip.companions, ...net.keys()])];
  const others = everyone.filter((person) => person !== SELF_ID);

  const confirmDelete = (id: string) =>
    showAlert(t("split.deletePaymentTitle"), t("split.deletePaymentBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => deleteSettlement(id) },
    ]);

  return (
    <View>
      <Text style={[styles.position, { color: myNet > 0 ? OWED : myNet < 0 ? OWES : c.text, fontFamily: f.semibold }]}>
        {myNet > 0
          ? t("split.youAreOwed", { amount: money(myNet) })
          : myNet < 0
            ? t("split.youOwe", { amount: money(-myNet) })
            : t("split.settled")}
      </Text>
      {splitExpenses.length === 0 && settlements.length === 0 ? (
        <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("split.emptyBody")}</Text>
      ) : null}

      {others.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people} style={styles.peopleScroll}>
          {others.map((person) => {
            const value = roundMoney(net.get(person) ?? 0, trip.currency);
            return (
              <View key={person} style={[styles.person, { backgroundColor: c.surface, borderColor: c.hairline }]}>
                <View style={[styles.avatar, { backgroundColor: c.surfaceStrong }]}>
                  <Text style={[styles.initial, { color: c.text, fontFamily: f.semibold }]}>{person.slice(0, 1).toUpperCase()}</Text>
                </View>
                <Text style={[styles.personName, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                  {personLabel(person, t)}
                </Text>
                <Text style={[styles.personNet, { color: value > 0 ? OWED : value < 0 ? OWES : c.textMuted, fontFamily: f.semibold }]}>
                  {value === 0 ? "—" : `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {transfers.length > 0 ? (
        <AuraCard style={styles.card}>
          {transfers.map((transfer, index) => (
            <View
              key={`${transfer.from}->${transfer.to}`}
              style={[styles.transfer, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]}
            >
              <View style={styles.flex}>
                <Text style={[styles.transferWho, { color: c.textSoft, fontFamily: f.regular }]} numberOfLines={1}>
                  {t("split.owes", { from: personLabel(transfer.from, t), to: personLabel(transfer.to, t) })}
                </Text>
                <Text style={[styles.transferAmount, { color: c.text, fontFamily: f.semibold }]}>{money(transfer.amount)}</Text>
              </View>
              <AuraButton label={t("split.settle")} icon="check" size="md" variant="secondary" onPress={() => setSettling(transfer)} />
            </View>
          ))}
        </AuraCard>
      ) : null}

      {unconverted > 0 ? (
        <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("split.unconverted", { count: unconverted })}</Text>
      ) : null}

      <AuraButton
        label={t("split.recordPayment")}
        icon="plus"
        variant="secondary"
        size="md"
        onPress={() => setSettling({ from: trip.companions[0] ?? SELF_ID, to: SELF_ID, amount: 0 })}
        style={styles.record}
      />

      {settlements.length > 0 ? (
        <>
          <AuraSection title={t("split.payments")} />
          {settlements.map((settlement) => (
            <PressableScale
              key={settlement.id}
              haptic={false}
              pressedScale={0.98}
              onLongPress={() => confirmDelete(settlement.id)}
              style={styles.payment}
            >
              <View style={styles.flex}>
                <Text style={[styles.paymentWho, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                  {t("split.paid", { from: personLabel(settlement.from, t), to: personLabel(settlement.to, t) })}
                </Text>
                <Text style={[styles.paymentDate, { color: c.textMuted, fontFamily: f.regular }]}>
                  {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(settlement.date))}
                </Text>
              </View>
              <Text style={[styles.paymentAmount, { color: c.text, fontFamily: f.semibold }]}>
                {formatMoney(formatCurrency, settlement.amount, settlement.currency)}
              </Text>
            </PressableScale>
          ))}
        </>
      ) : null}

      <SettleUpSheet trip={trip} everyone={everyone} initial={settling} onClose={() => setSettling(null)} />
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
  initial: Transfer | null;
  onClose: () => void;
}) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const addSettlement = useExpensesStore((state) => state.addSettlement);
  const decimalSeparator = localeDecimalSeparator(locale);
  const [from, setFrom] = useState(SELF_ID);
  const [to, setTo] = useState(SELF_ID);
  const [amount, setAmount] = useState("");
  const [shown, setShown] = useState<Transfer | null>(null);

  // Reset the form each time the sheet opens with a new transfer.
  if (initial && initial !== shown) {
    setShown(initial);
    setFrom(initial.from);
    setTo(initial.to);
    setAmount(initial.amount > 0 ? String(initial.amount).replace(".", decimalSeparator) : "");
  }

  const save = () => {
    const value = parseAmountInput(amount, decimalSeparator);
    if (!Number.isFinite(value) || value <= 0 || from === to) {
      showAlert(t("expenses.validationTitle"), t("split.paymentValidation"));
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
    showInterstitial("settlement_recorded");
  };

  const picker = (label: string, selected: string, onSelect: (person: string) => void) => (
    <View style={styles.group}>
      <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{label}</Text>
      <View style={styles.chips}>
        {everyone.map((person) => (
          <AuraChip key={person} label={personLabel(person, t)} selected={person === selected} onPress={() => onSelect(person)} />
        ))}
      </View>
    </View>
  );

  return (
    <AuraSheet
      visible={initial !== null}
      onClose={onClose}
      title={t("split.recordPayment")}
      footer={<AuraButton label={t("split.savePayment")} onPress={save} />}
    >
      <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        {picker(t("split.whoPaid"), from, setFrom)}
        {picker(t("split.whoReceived"), to, setTo)}
        <AuraField
          label={`${t("expenses.amount")} · ${trip.currency}`}
          value={amount}
          onChangeText={(value) => setAmount(value.replace(/[^0-9.,]/g, ""))}
          keyboardType="decimal-pad"
          placeholder="0"
          large
        />
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  position: { fontSize: 26, letterSpacing: -0.7, marginTop: 4 },
  body: { fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  peopleScroll: { marginHorizontal: -20, marginTop: 18 },
  people: { paddingHorizontal: 20, gap: 10 },
  person: { width: 112, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  initial: { fontSize: 15 },
  personName: { fontSize: 14 },
  personNet: { fontSize: 14, fontVariant: ["tabular-nums"] },
  card: { marginTop: 16, paddingVertical: 6 },
  transfer: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  transferWho: { fontSize: 13.5 },
  transferAmount: { fontSize: 18, marginTop: 2, fontVariant: ["tabular-nums"] },
  note: { fontSize: 12.5, marginTop: 10 },
  record: { alignSelf: "flex-start", marginTop: 16 },
  payment: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  paymentWho: { fontSize: 15 },
  paymentDate: { fontSize: 12.5, marginTop: 2 },
  paymentAmount: { fontSize: 15, fontVariant: ["tabular-nums"] },
  sheetBody: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 20 },
  group: { gap: 10 },
  label: { fontSize: 13.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
