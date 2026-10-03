import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
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
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, formatCurrency } = useLocalization();

  const chip = (active: boolean) => [
    styles.chip,
    { backgroundColor: active ? theme.tealSoft : theme.paper, borderColor: active ? theme.teal : theme.hairline },
  ];
  const chipText = (active: boolean) => [styles.chipText, { color: active ? theme.inkDeep : theme.inkSoft }];

  const resolution = Number.isFinite(amount) && amount > 0
    ? splitValueToShares(value, amount, currency, decimalSeparator)
    : null;
  const assigned = Object.values(value.custom).reduce((sum, text) => {
    const parsed = parseAmountInput(text, decimalSeparator);
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);

  const togglePerson = (person: string) => {
    const people = value.people.includes(person)
      ? value.people.filter((entry) => entry !== person)
      : [...value.people, person];
    onChange({ ...value, people });
  };

  return (
    <View style={styles.root}>
      <View style={styles.group}>
        <Text style={[styles.label, { color: theme.inkMuted }]}>{t("split.paidBy")}</Text>
        <View style={styles.row}>
          {everyone.map((person) => {
            const active = value.paidBy === person;
            return (
              <Pressable key={person} onPress={() => onChange({ ...value, paidBy: person })} style={chip(active)}>
                <Text style={chipText(active)}>{personLabel(person, t)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={[styles.label, { color: theme.inkMuted }]}>{t("split.title")}</Text>
        <View style={styles.row}>
          {(["none", "equal", "custom"] as const).map((mode) => {
            const active = value.mode === mode;
            return (
              <Pressable key={mode} onPress={() => onChange({ ...value, mode })} style={chip(active)}>
                <Text style={chipText(active)}>{t(`split.mode.${mode}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {value.mode === "equal" ? (
        <View style={styles.group}>
          <View style={styles.row}>
            {everyone.map((person) => {
              const active = value.people.includes(person);
              return (
                <Pressable key={person} onPress={() => togglePerson(person)} style={chip(active)}>
                  {active ? <Icon name="check" size={13} color={theme.teal} strokeWidth={2.4} /> : null}
                  <Text style={chipText(active)}>{personLabel(person, t)}</Text>
                </Pressable>
              );
            })}
          </View>
          {resolution?.ok && resolution.shares.length > 0 ? (
            <Text style={[styles.hint, { color: theme.inkSoft }]}>
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
            <View key={person} style={[styles.customRow, { borderColor: theme.hairline, backgroundColor: theme.paper }]}>
              <Text style={[styles.customName, { color: theme.inkDeep }]}>{personLabel(person, t)}</Text>
              <TextInput
                value={value.custom[person] ?? ""}
                onChangeText={(text) =>
                  onChange({ ...value, custom: { ...value.custom, [person]: text.replace(/[^0-9.,]/g, "") } })
                }
                placeholder="0"
                placeholderTextColor={theme.inkMuted}
                keyboardType="decimal-pad"
                style={[styles.customInput, { color: theme.inkDeep }]}
              />
            </View>
          ))}
          {Number.isFinite(amount) && amount > 0 ? (
            <Text
              style={[
                styles.hint,
                { color: resolution && !resolution.ok ? theme.stamp : theme.inkSoft },
              ]}
            >
              {t("split.leftToAssign", { amount: formatMoney(formatCurrency, amount - assigned, currency) })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  group: { gap: 8 },
  label: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  hint: { fontFamily: NOMAD_FONTS.ui, fontSize: 12.5 },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  customName: { flex: 1, fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  customInput: {
    minWidth: 90,
    minHeight: 44,
    textAlign: "right",
    fontFamily: NOMAD_FONTS.monoMedium,
    fontSize: 15,
  },
});
