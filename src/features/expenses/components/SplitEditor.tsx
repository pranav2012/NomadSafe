import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { AuraChip, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import type { TranslateParams } from "@/localization/translate";
import { parseAmountInput } from "@/features/expenses/utils/amountInput";
import { formatMoney } from "@/features/expenses/utils/money";
import {
  isEqualSplit,
  payersMatchTotal,
  resolveShares,
  SELF_ID,
  splitByPercent,
  type ExpensePayer,
  type ExpenseShare,
  type ExpenseSplit,
} from "@/features/expenses/utils/split";

export type SplitChoice = "none" | "equal" | "percent" | "custom";

export interface SplitValue {
  paidBy: string;
  /** Several people paid; their amounts are in `payers`. */
  multiPay: boolean;
  payers: Record<string, string>;
  mode: SplitChoice;
  people: string[];
  custom: Record<string, string>;
  percents: Record<string, string>;
}

export type SplitResolution =
  | { ok: true; shares: ExpenseShare[] }
  | { ok: false; reason: "no-people" | "over-total" | "under-total" | "not-100" };

export function personLabel(person: string, t: (key: string, params?: TranslateParams) => string): string {
  return person === SELF_ID ? t("split.you") : person;
}

const toText = (value: number, decimalSeparator: string) => String(value).replace(".", decimalSeparator);

export function initialSplitValue(
  everyone: string[],
  decimalSeparator: string,
  source?: { paidBy?: string; payers?: ExpensePayer[]; shares?: ExpenseShare[]; split?: ExpenseSplit; currency: string },
): SplitValue {
  const shares = source?.shares ?? [];
  const payers: Record<string, string> = {};
  for (const payer of source?.payers ?? []) payers[payer.person] = toText(payer.amount, decimalSeparator);
  const base: SplitValue = {
    paidBy: source?.paidBy ?? SELF_ID,
    multiPay: (source?.payers?.length ?? 0) > 0,
    payers,
    mode: "none",
    people: everyone,
    custom: {},
    percents: {},
  };
  if (shares.length === 0) return base;
  const mode = source?.split?.mode ?? (isEqualSplit(shares, source?.currency ?? "USD") ? "equal" : "custom");
  if (mode === "equal") return { ...base, mode, people: shares.map((share) => share.person) };
  if (mode === "percent" && source?.split?.percents) {
    const percents: Record<string, string> = {};
    for (const [person, percent] of Object.entries(source.split.percents)) percents[person] = toText(percent, decimalSeparator);
    return { ...base, mode, percents };
  }
  const custom: Record<string, string> = {};
  for (const share of shares) custom[share.person] = toText(share.amount, decimalSeparator);
  return { ...base, mode: "custom", custom };
}

function parsedEntries(values: Record<string, string>, decimalSeparator: string) {
  return Object.entries(values)
    .map(([person, text]) => ({ person, amount: parseAmountInput(text, decimalSeparator) }))
    .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0);
}

/** Null for a personal (unsplit) spend. */
export function splitValueToShares(
  value: SplitValue,
  amount: number,
  currency: string,
  decimalSeparator: string,
): SplitResolution | null {
  if (value.mode === "none") return null;
  if (value.mode === "equal") return resolveShares(amount, currency, value.people);
  if (value.mode === "percent") {
    const percents = Object.fromEntries(parsedEntries(value.percents, decimalSeparator).map((entry) => [entry.person, entry.amount]));
    return splitByPercent(amount, currency, percents);
  }
  return resolveShares(amount, currency, [], parsedEntries(value.custom, decimalSeparator));
}

/** The split mode and percents to store with the expense, so editing reopens it the same way. */
export function splitValueToStored(value: SplitValue, decimalSeparator: string): ExpenseSplit | undefined {
  if (value.mode === "none") return undefined;
  if (value.mode !== "percent") return { mode: value.mode };
  const percents = Object.fromEntries(parsedEntries(value.percents, decimalSeparator).map((entry) => [entry.person, entry.amount]));
  return { mode: "percent", percents };
}

/** Null when one person paid; otherwise the payers, or "payers-total" when they don't add up. */
export function splitValueToPayers(
  value: SplitValue,
  amount: number,
  currency: string,
  decimalSeparator: string,
): { ok: true; payers: ExpensePayer[] } | { ok: false; reason: "payers-total" } | null {
  if (!value.multiPay) return null;
  const payers = parsedEntries(value.payers, decimalSeparator);
  if (!payersMatchTotal(amount, currency, payers)) return { ok: false, reason: "payers-total" };
  return { ok: true, payers };
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

  const hasAmount = Number.isFinite(amount) && amount > 0;
  const resolution = hasAmount ? splitValueToShares(value, amount, currency, decimalSeparator) : null;
  const sumOf = (values: Record<string, string>) =>
    Object.values(values).reduce((sum, text) => {
      const parsed = parseAmountInput(text, decimalSeparator);
      return Number.isFinite(parsed) ? sum + parsed : sum;
    }, 0);

  const togglePerson = (person: string) => {
    const people = value.people.includes(person) ? value.people.filter((entry) => entry !== person) : [...value.people, person];
    onChange({ ...value, people });
  };

  const label = (text: string) => <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{text}</Text>;
  const hint = (text: string, bad = false) => <Text style={[styles.hint, { color: bad ? auraStatusAccent.alert : c.textSoft, fontFamily: f.regular }]}>{text}</Text>;

  const amountRows = (field: "payers" | "custom" | "percents", suffix?: string) =>
    everyone.map((person) => (
      <View key={person} style={[styles.customRow, { borderColor: c.hairline, backgroundColor: c.surface }]}>
        <Text style={[styles.customName, { color: c.text, fontFamily: f.medium }]}>{personLabel(person, t)}</Text>
        <TextInput
          value={value[field][person] ?? ""}
          onChangeText={(text) => onChange({ ...value, [field]: { ...value[field], [person]: text.replace(/[^0-9.,]/g, "") } })}
          placeholder="0"
          placeholderTextColor={c.textMuted}
          keyboardType="decimal-pad"
          accessibilityLabel={personLabel(person, t)}
          style={[styles.customInput, { color: c.text, fontFamily: f.semibold }]}
        />
        {suffix ? <Text style={[styles.suffix, { color: c.textSoft, fontFamily: f.semibold }]}>{suffix}</Text> : null}
      </View>
    ));

  const paid = sumOf(value.payers);
  const percentLeft = 100 - sumOf(value.percents);

  return (
    <View style={styles.root}>
      <View style={styles.group}>
        {label(t("split.paidBy"))}
        <View style={styles.row}>
          {everyone.map((person) => (
            <AuraChip
              key={person}
              label={personLabel(person, t)}
              selected={!value.multiPay && value.paidBy === person}
              onPress={() => onChange({ ...value, paidBy: person, multiPay: false })}
            />
          ))}
          <AuraChip label={t("split.severalPayers")} icon="users" selected={value.multiPay} onPress={() => onChange({ ...value, multiPay: true })} />
        </View>
        {value.multiPay ? (
          <>
            {amountRows("payers")}
            {hasAmount ? hint(t("split.paidSoFar", { paid: formatMoney(formatCurrency, paid, currency), total: formatMoney(formatCurrency, amount, currency) }), Math.abs(paid - amount) > 0.001) : null}
          </>
        ) : null}
      </View>

      <View style={styles.group}>
        {label(t("split.title"))}
        <View style={styles.row}>
          {(["none", "equal", "percent", "custom"] as const).map((mode) => (
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
          {resolution?.ok && resolution.shares.length > 0
            ? hint(
                t("split.eachPays", {
                  amount: formatMoney(formatCurrency, resolution.shares[resolution.shares.length - 1].amount, currency),
                  count: resolution.shares.length,
                }),
              )
            : null}
        </View>
      ) : null}

      {value.mode === "percent" ? (
        <View style={styles.group}>
          {amountRows("percents", "%")}
          {hint(t("split.percentLeft", { percent: Math.round(percentLeft * 100) / 100 }), Math.abs(percentLeft) > 0.001)}
        </View>
      ) : null}

      {value.mode === "custom" ? (
        <View style={styles.group}>
          {amountRows("custom")}
          {hasAmount ? hint(t("split.leftToAssign", { amount: formatMoney(formatCurrency, amount - sumOf(value.custom), currency) }), !!resolution && !resolution.ok) : null}
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
  suffix: { fontSize: 15, marginLeft: 4 },
});
