import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraSheet, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import type { ReceiptItems } from "@/modules/ai";
import { personLabel } from "@/features/expenses/components/SplitEditor";
import { formatMoney } from "@/features/expenses/utils/money";
import { itemWeights } from "@/features/expenses/utils/receiptText";

/** Pro: who had what on a receipt. Each item starts with everyone; Apply turns it into a custom split. */
export function ReceiptItemsSheet({
  receipt,
  everyone,
  currency,
  onClose,
  onApply,
}: {
  receipt: ReceiptItems | null;
  everyone: string[];
  currency: string;
  onClose: () => void;
  onApply: (weights: Record<string, number>) => void;
}) {
  return (
    <AuraSheet visible={receipt !== null} onClose={onClose} title={undefined} full>
      {receipt ? <ItemsBody receipt={receipt} everyone={everyone} currency={currency} onClose={onClose} onApply={onApply} /> : null}
    </AuraSheet>
  );
}

function ItemsBody({
  receipt,
  everyone,
  currency,
  onClose,
  onApply,
}: {
  receipt: ReceiptItems;
  everyone: string[];
  currency: string;
  onClose: () => void;
  onApply: (weights: Record<string, number>) => void;
}) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const [people, setPeople] = useState<string[][]>(() => receipt.items.map(() => everyone));
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);
  const weights = itemWeights(
    receipt.items.map((item, index) => ({ amount: item.amount, people: people[index] })),
    receipt.extras,
  );

  const toggle = (index: number, person: string) =>
    setPeople((current) =>
      current.map((list, i) => (i !== index ? list : list.includes(person) ? list.filter((entry) => entry !== person) : [...list, person])),
    );

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("receipt.itemsTitle")}</Text>
        <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t("receipt.itemsIntro")}</Text>
        {receipt.items.map((item, index) => (
          <View key={`${item.name}-${index}`} style={[styles.item, { borderColor: c.hairline }]}>
            <View style={styles.itemHead}>
              <Text style={[styles.itemName, { color: c.text, fontFamily: f.medium }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[styles.itemAmount, { color: c.text, fontFamily: f.semibold }]}>{money(item.amount)}</Text>
            </View>
            <View style={styles.chips}>
              {everyone.map((person) => (
                <AuraChip key={person} label={personLabel(person, t)} selected={people[index].includes(person)} onPress={() => toggle(index, person)} />
              ))}
            </View>
          </View>
        ))}
        {receipt.extras > 0 ? (
          <Text style={[styles.intro, { color: c.textMuted, fontFamily: f.regular }]}>{t("receipt.extras", { amount: money(receipt.extras) })}</Text>
        ) : null}
        <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          {Object.entries(weights).map(([person, weight]) => (
            <View key={person} style={styles.summaryRow}>
              <Text style={[styles.summaryName, { color: c.text, fontFamily: f.regular }]}>{personLabel(person, t)}</Text>
              <Text style={[styles.summaryAmount, { color: c.text, fontFamily: f.semibold }]}>{money(weight)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <AuraButton label={t("common.cancel")} variant="secondary" onPress={onClose} style={styles.flex} />
        <AuraButton
          label={t("receipt.apply")}
          icon="check"
          disabled={Object.keys(weights).length === 0}
          onPress={() => {
            onApply(weights);
            onClose();
          }}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  title: { fontSize: 22, letterSpacing: -0.5 },
  intro: { fontSize: 14, lineHeight: 20 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 8 },
  itemHead: { flexDirection: "row", gap: 12 },
  itemName: { flex: 1, fontSize: 15 },
  itemAmount: { fontSize: 15, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  summary: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8, marginTop: 6 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryName: { fontSize: 14.5 },
  summaryAmount: { fontSize: 14.5, fontVariant: ["tabular-nums"] },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 10 },
});
