import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraCard, AuraChip, AuraField, AuraSheet, showAlert, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { showInterstitial } from "@/modules/ads";
import type { GroupBase } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useGroupBalances } from "@/features/expenses/hooks/useGroupBalances";
import { personLabel } from "@/features/expenses/components/SplitEditor";
import { formatMoney } from "@/features/expenses/utils/money";
import { localeDecimalSeparator, parseAmountInput } from "@/features/expenses/utils/amountInput";
import { SELF_ID, type Transfer } from "@/features/expenses/utils/split";

export const OWED = "#3DDC97";
export const OWES = auraStatusAccent.alert;

/** Who owes whom in a trip or group: your balance, one row per person with Settle, and a way to record a payment. */
export function GroupBalances({ group }: { group: GroupBase }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const [settling, setSettling] = useState<Transfer | null>(null);
  const { transfers, myNet, unconverted, everyone, splitExpenses, settlements } = useGroupBalances(group);
  const money = (amount: number) => formatMoney(formatCurrency, amount, group.currency);

  const withMe = new Map<string, number>();
  for (const transfer of transfers) {
    if (transfer.to === SELF_ID) withMe.set(transfer.from, (withMe.get(transfer.from) ?? 0) + transfer.amount);
    if (transfer.from === SELF_ID) withMe.set(transfer.to, (withMe.get(transfer.to) ?? 0) - transfer.amount);
  }
  const others = everyone.filter((person) => person !== SELF_ID);
  const between = transfers.filter((transfer) => transfer.from !== SELF_ID && transfer.to !== SELF_ID);
  const empty = splitExpenses.length === 0 && settlements.length === 0;

  return (
    <View>
      <Text style={[styles.caption, { color: c.textMuted, fontFamily: f.medium }]}>{t("money.yourBalance")}</Text>
      <Text style={[styles.position, { color: myNet > 0 ? OWED : myNet < 0 ? OWES : c.text, fontFamily: f.semibold }]}>
        {myNet > 0 ? t("split.youAreOwed", { amount: money(myNet) }) : myNet < 0 ? t("split.youOwe", { amount: money(-myNet) }) : t("split.settled")}
      </Text>
      {empty ? <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("split.emptyBody")}</Text> : null}

      {others.length > 0 && !empty ? (
        <AuraCard style={styles.card}>
          {others.map((person, index) => {
            const value = withMe.get(person) ?? 0;
            return (
              <View key={person} style={[styles.person, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]}>
                <View style={[styles.avatar, { backgroundColor: c.surfaceStrong }]}>
                  <Text style={[styles.initial, { color: c.text, fontFamily: f.semibold }]}>{person.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.personName, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                    {personLabel(person, t)}
                  </Text>
                  <Text style={[styles.personNet, { color: value > 0 ? OWED : value < 0 ? OWES : c.textMuted, fontFamily: f.regular }]}>
                    {value > 0 ? t("split.owesYou", { amount: money(value) }) : value < 0 ? t("split.youOweThem", { amount: money(-value) }) : t("split.settledWith")}
                  </Text>
                </View>
                {value !== 0 ? (
                  <AuraButton
                    label={t("split.settle")}
                    icon="check"
                    size="md"
                    variant="secondary"
                    onPress={() => setSettling(value > 0 ? { from: person, to: SELF_ID, amount: value } : { from: SELF_ID, to: person, amount: -value })}
                  />
                ) : null}
              </View>
            );
          })}
        </AuraCard>
      ) : null}

      {between.length > 0 ? (
        <>
          <Text style={[styles.subhead, { color: c.textMuted, fontFamily: f.medium }]}>{t("split.betweenOthers")}</Text>
          {between.map((transfer) => (
            <View key={`${transfer.from}->${transfer.to}`} style={styles.between}>
              <Text style={[styles.betweenWho, { color: c.textSoft, fontFamily: f.regular }]} numberOfLines={1}>
                {t("split.owes", { from: personLabel(transfer.from, t), to: personLabel(transfer.to, t) })} · {money(transfer.amount)}
              </Text>
              <AuraButton label={t("split.settle")} size="md" variant="ghost" onPress={() => setSettling(transfer)} />
            </View>
          ))}
        </>
      ) : null}

      {unconverted > 0 ? <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("split.unconverted", { count: unconverted })}</Text> : null}

      {others.length > 0 ? (
        <AuraButton
          label={t("split.recordPayment")}
          icon="plus"
          variant="secondary"
          size="md"
          onPress={() => setSettling({ from: others[0] ?? SELF_ID, to: SELF_ID, amount: 0 })}
          style={styles.record}
        />
      ) : null}

      <SettleUpSheet group={group} everyone={everyone} initial={settling} onClose={() => setSettling(null)} />
    </View>
  );
}

function SettleUpSheet({
  group,
  everyone,
  initial,
  onClose,
}: {
  group: GroupBase;
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
      groupId: group.id,
      from,
      to,
      amount: value,
      currency: group.currency,
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
          label={`${t("expenses.amount")} · ${group.currency}`}
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
  caption: { fontSize: 13 },
  position: { fontSize: 28, letterSpacing: -0.8, marginTop: 4 },
  body: { fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  card: { marginTop: 16, paddingVertical: 4 },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 15 },
  personName: { fontSize: 15 },
  personNet: { fontSize: 13.5, marginTop: 2, fontVariant: ["tabular-nums"] },
  subhead: { fontSize: 13, marginTop: 18, marginBottom: 2 },
  between: { flexDirection: "row", alignItems: "center", gap: 10 },
  betweenWho: { flex: 1, fontSize: 14 },
  note: { fontSize: 12.5, marginTop: 10 },
  record: { alignSelf: "flex-start", marginTop: 16 },
  sheetBody: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 20 },
  group: { gap: 10 },
  label: { fontSize: 13.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
