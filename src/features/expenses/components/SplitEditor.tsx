import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useAura } from "@/components/aura/useAura";
import { AuraChip } from "@/components/aura/AuraChip";
import { useLocalization } from "@/localization";
import type { TranslateParams } from "@/localization/translate";
import { parseAmountInput } from "@/features/expenses/utils/amountInput";
import { formatMoney } from "@/features/expenses/utils/money";
import {
  isEqualSplit,
  resolveShares,
  SELF_ID,
  type ExpenseShare,
  type ShareResolution,
} from "@/features/expenses/utils/split";

export type SplitMode = "none" | "equal" | "custom";

export interface SplitValue {
  paidBy: string;
  mode: SplitMode;
  people: string[];
  custom: Record<string, string>;
}

export function personLabel(person: string, t: (key: string, params?: TranslateParams) => string): string {
  return person === SELF_ID ? t("split.you") : person;
}

export function initialSplitValue(
  everyone: string[],
  decimalSeparator: string,
  source?: { paidBy?: string; shares?: ExpenseShare[]; currency: string },
): SplitValue {
  const shares = source?.shares ?? [];
  const paidBy = source?.paidBy ?? SELF_ID;
  if (shares.length === 0) return { paidBy, mode: "none", people: everyone, custom: {} };
  if (isEqualSplit(shares, source?.currency ?? "USD")) {
    return { paidBy, mode: "equal", people: shares.map((share) => share.person), custom: {} };
  }
  const custom: Record<string, string> = {};
  for (const share of shares) custom[share.person] = String(share.amount).replace(".", decimalSeparator);
  return { paidBy, mode: "custom", people: everyone, custom };
}

/** Null for a personal (unsplit) spend. */
export function splitValueToShares(
  value: SplitValue,
  amount: number,
  currency: string,
  decimalSeparator: string,
): ShareResolution | null {
  if (value.mode === "none") return null;
  if (value.mode === "equal") return resolveShares(amount, currency, value.people);
  const explicit = Object.entries(value.custom)
    .map(([person, text]) => ({ person, amount: parseAmountInput(text, decimalSeparator) }))
    .filter((share) => Number.isFinite(share.amount) && share.amount > 0);
  return resolveShares(amount, currency, [], explicit);
}

export function SplitEditor({
  everyone,
  value,
  onChange,
  amount,
  currency,
  decimalSeparator,
}: {
  everyone: string[];
  value: SplitValue;
  onChange: (next: SplitValue) => void;
  amount: number;
  currency: string;
  decimalSeparator: string;
}) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();

  const resolution = Number.isFinite(amount) && amount > 0 ? splitValueToShares(value, amount, currency, decimalSeparator) : null;
  const assigned = Object.values(value.custom).reduce((sum, text) => {
    const parsed = parseAmountInput(text, decimalSeparator);
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);

  const togglePerson = (person: string) => {
    const people = value.people.includes(person) ? value.people.filter((entry) => entry !== person) : [...value.people, person];
    onChange({ ...value, people });
  };

  const label = (text: string) => <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{text}</Text>;

  return (
    <View style={styles.root}>
      <View style={styles.group}>
        {label(t("split.paidBy"))}
        <View style={styles.row}>
          {everyone.map((person) => (
            <AuraChip key={person} label={personLabel(person, t)} selected={value.paidBy === person} onPress={() => onChange({ ...value, paidBy: person })} />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        {label(t("split.title"))}
        <View style={styles.row}>
          {(["none", "equal", "custom"] as const).map((mode) => (
            <AuraChip key={mode} label={t(`split.mode.${mode}`)} selected={value.mode === mode} onPress={() => onChange({ ...value, mode })} />
          ))}
        </View>
      </View>

      {value.mode === "equal" ? (
        <View style={styles.group}>
          <View style={styles.row}>
            {everyone.map((person) => {
              const active = value.people.includes(person);
              return (
                <AuraChip key={person} label={personLabel(person, t)} icon={active ? "check" : undefined} selected={active} onPress={() => togglePerson(person)} />
              );
            })}
          </View>
          {resolution?.ok && resolution.shares.length > 0 ? (
            <Text style={[styles.hint, { color: c.textSoft, fontFamily: f.regular }]}>
              {t("split.eachPays", {
                amount: formatMoney(formatCurrency, resolution.shares[resolution.shares.length - 1].amount, currency),
                count: resolution.shares.length,
              })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {value.mode === "custom" ? (
        <View style={styles.group}>
          {everyone.map((person) => (
            <View key={person} style={[styles.customRow, { borderColor: c.hairline, backgroundColor: c.surface }]}>
              <Text style={[styles.customName, { color: c.text, fontFamily: f.medium }]}>{personLabel(person, t)}</Text>
              <TextInput
                value={value.custom[person] ?? ""}
                onChangeText={(text) => onChange({ ...value, custom: { ...value.custom, [person]: text.replace(/[^0-9.,]/g, "") } })}
                placeholder="0"
                placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad"
                style={[styles.customInput, { color: c.text, fontFamily: f.semibold }]}
              />
            </View>
          ))}
          {Number.isFinite(amount) && amount > 0 ? (
            <Text style={[styles.hint, { color: resolution && !resolution.ok ? "#FF4D5E" : c.textSoft, fontFamily: f.regular }]}>
              {t("split.leftToAssign", { amount: formatMoney(formatCurrency, amount - assigned, currency) })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 18 },
  group: { gap: 8 },
  label: { fontSize: 13.5 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { fontSize: 13 },
  customRow: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 14 },
  customName: { flex: 1, fontSize: 14.5 },
  customInput: { minWidth: 90, minHeight: 48, textAlign: "right", fontSize: 16 },
});
