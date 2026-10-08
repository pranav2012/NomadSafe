import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraField, AuraListGroup, AuraListRow, AuraProgressBar, AuraSheet, Icon, PressableScale, showAlert, useAura, type IconName } from "@/atoms";
import { auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { closePocket, deletePocket, logUntrackedCash, removeLoad, removeUntracked, reopenPocket } from "@/features/expenses/services/forexPockets";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useForexSheetStore, type PocketSheetStep } from "@/features/expenses/store/forexSheetStore";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";
import { localeDecimalSeparator, parseAmountInput } from "@/features/expenses/utils/amountInput";
import { conversionResult, countedGap, pocketBalance, pocketSpends, type ForexPocket, type PocketCloseKind } from "@/features/expenses/utils/forex";
import { formatMoney } from "@/features/expenses/utils/money";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { dateTimeFormat } from "@/utils/intl";

/** One forex pocket: its balance and history, top-up, counting cash and what happened to the leftover. */
export function PocketSheet({ onTopUp }: { onTopUp: (pocket: ForexPocket) => void }) {
  const { t } = useLocalization();
  const pocketId = useForexSheetStore((state) => state.pocketId);
  const step = useForexSheetStore((state) => state.step);
  const close = useForexSheetStore((state) => state.close);
  const pocket = usePocketsStore((state) => state.pockets.find((entry) => entry.id === pocketId) ?? null);
  const title = pocket ? t("forex.pocketName", { kind: t(pocket.kind === "card" ? "forex.kindCard" : "forex.kindCash"), currency: pocket.currency }) : undefined;
  return (
    <AuraSheet visible={pocket !== null} onClose={close} title={title}>
      {pocket ? <PocketBody key={`${pocket.id}-${step}`} pocket={pocket} initialStep={step} onClose={close} onTopUp={onTopUp} /> : null}
    </AuraSheet>
  );
}

function PocketBody({
  pocket,
  initialStep,
  onClose,
  onTopUp,
}: {
  pocket: ForexPocket;
  initialStep: PocketSheetStep;
  onClose: () => void;
  onTopUp: (pocket: ForexPocket) => void;
}) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  const expenses = useExpensesStore((state) => state.expenses);
  const [step, setStep] = useState<PocketSheetStep>(initialStep);
  const closedText = useClosedSummary(pocket);
  const balance = pocketBalance(pocket, expenses);
  const spends = pocketSpends(pocket, expenses).filter((expense) => expense.source !== "forex");
  const untracked = pocketSpends(pocket, expenses).filter((expense) => expense.source === "forex" && expense.id !== pocket.closed?.expenseId);
  const spendsTotal = spends.reduce((sum, expense) => sum + expense.amount, 0);
  const money = (amount: number, currency = pocket.currency) => formatMoney(formatCurrency, amount, currency);
  const fullDate = (iso: string) => dateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso));
  const isCard = pocket.kind === "card";

  // Edits need Plus; a Free plan can still look at (and delete) its pockets.
  const gated = (action: () => void) => {
    if (plus.isPlus) {
      action();
      return;
    }
    onClose();
    plus.run("forex", action);
  };

  if (step === "count") return <CountStep pocket={pocket} left={balance.left} onBack={() => setStep("main")} onDone={onClose} />;
  if (step === "leftover") return <LeftoverStep pocket={pocket} left={balance.left} rate={balance.rate} onBack={() => setStep("main")} onDone={onClose} />;


  const confirmRemoveLoad = (loadId: string) =>
    gated(() =>
      showAlert(t("forex.removeLoadTitle"), t("forex.removeLoadBody"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: () => removeLoad(pocket, loadId) },
      ]),
    );

  const confirmDelete = () =>
    showAlert(t("forex.deleteTitle"), t("forex.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          onClose();
          deletePocket(pocket);
        },
      },
    ]);

  const actions: { icon: IconName; label: string; onPress: () => void; destructive?: boolean }[] = pocket.closed
    ? [{ icon: "swap", label: t("forex.reopen"), onPress: () => gated(() => reopenPocket(pocket)) }]
    : [
        {
          icon: "plus",
          label: t("forex.topUp"),
          onPress: () =>
            gated(() => {
              onClose();
              onTopUp(pocket);
            }),
        },
        { icon: isCard ? "creditCard" : "banknote", label: t(isCard ? "forex.countCard" : "forex.count"), onPress: () => gated(() => setStep("count")) },
        { icon: "check", label: t("forex.leftover"), onPress: () => gated(() => setStep("leftover")) },
      ];

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <View>
        <Text style={[styles.left, { color: balance.left < 0 ? auraSignal.amber : c.text, fontFamily: f.semibold }]}>{t("forex.left", { amount: money(balance.left) })}</Text>
        <Text style={[styles.sub, { color: c.textSoft, fontFamily: f.regular }]}>
          {t("forex.ofLoaded", { loaded: money(balance.loaded), spent: money(balance.spent) })}
        </Text>
        <AuraProgressBar value={balance.loaded > 0 ? balance.spent / balance.loaded : 0} style={styles.progress} />
        <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>
          {t("forex.rate", { from: pocket.currency, rate: formatCurrency(balance.rate, pocket.homeCurrency, { maximumFractionDigits: 4 }) })}
          {balance.spent > 0 ? ` · ${t("forex.spentValue", { amount: money(balance.spentValue, pocket.homeCurrency) })}` : ""}
        </Text>
        {balance.left < 0 ? <Text style={[styles.note, { color: auraSignal.amber, fontFamily: f.regular }]}>{t("forex.overspent", { amount: money(-balance.left) })}</Text> : null}
        {closedText ? <Text style={[styles.note, { color: c.text, fontFamily: f.medium }]}>{closedText}</Text> : null}
        {!plus.isPlus ? <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("forex.readOnly")}</Text> : null}
      </View>

      <View style={styles.group}>
        <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("forex.loads")}</Text>
        {pocket.loads.map((load) => {
          const fee = load.feeExpenseId ? expenses.find((expense) => expense.id === load.feeExpenseId) : undefined;
          return (
            <View key={load.id} style={[styles.load, { borderColor: c.hairline }]}>
              <View style={styles.loadText}>
                <Text style={[styles.loadTitle, { color: c.text, fontFamily: f.medium }]}>
                  {load.carriedFrom ? t("forex.loadCarried", { amount: money(load.amount) }) : t("forex.loadRow", { amount: money(load.amount), paid: money(load.paid, pocket.homeCurrency) })}
                </Text>
                <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>
                  {[fullDate(load.date), fee ? t("forex.loadFee", { fee: money(fee.amount, fee.currency) }) : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {pocket.loads.length > 1 && !pocket.closed ? (
                <PressableScale onPress={() => confirmRemoveLoad(load.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.delete")}>
                  <Icon name="x" size={16} color={c.textMuted} />
                </PressableScale>
              ) : null}
            </View>
          );
        })}
        {untracked.map((expense) => (
          <View key={expense.id} style={[styles.load, { borderColor: c.hairline }]}>
            <View style={styles.loadText}>
              <Text style={[styles.loadTitle, { color: c.text, fontFamily: f.medium }]}>{`${expense.merchant} · ${money(expense.amount)}`}</Text>
              <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{fullDate(expense.date)}</Text>
            </View>
            {pocket.closed ? null : (
              <PressableScale
                onPress={() =>
                  gated(() =>
                    showAlert(t("forex.removeLoadTitle"), undefined, [
                      { text: t("common.cancel"), style: "cancel" },
                      { text: t("common.delete"), style: "destructive", onPress: () => removeUntracked(pocket, expense.id) },
                    ]),
                  )
                }
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t("common.delete")}
              >
                <Icon name="x" size={16} color={c.textMuted} />
              </PressableScale>
            )}
          </View>
        ))}
        {spends.length > 0 ? (
          <Text style={[styles.note, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.spends", { count: spends.length, amount: money(spendsTotal) })}</Text>
        ) : null}
      </View>

      <AuraListGroup style={styles.actions}>
        {actions.map((action) => (
          <AuraListRow key={action.label} icon={action.icon} label={action.label} onPress={action.onPress} />
        ))}
        <AuraListRow icon="trash" label={t("forex.delete")} destructive onPress={confirmDelete} />
      </AuraListGroup>
    </ScrollView>
  );
}

/** What happened to a closed pocket's leftover, e.g. "Converted ¥8,200 back". */
export function useClosedSummary(pocket: ForexPocket): string | null {
  const { t, formatCurrency } = useLocalization();
  const trips = useTripsStore((state) => state.trips);
  const closed = pocket.closed;
  if (!closed) return null;
  const amount = formatMoney(formatCurrency, closed.leftover, pocket.currency);
  if (closed.kind === "kept") {
    const target = closed.carriedTo ? trips.find((trip) => trip.id === closed.carriedTo) : undefined;
    return target ? t("forex.closedKeptMoved", { amount, trip: target.name }) : t("forex.closedKept", { amount });
  }
  if (closed.kind === "converted") return t("forex.closedConverted", { amount });
  return t("forex.closedWrittenOff", { amount });
}

function CountStep({ pocket, left, onBack, onDone }: { pocket: ForexPocket; left: number; onBack: () => void; onDone: () => void }) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const separator = useMemo(() => localeDecimalSeparator(locale), [locale]);
  const [counted, setCounted] = useState("");
  const value = parseAmountInput(counted, separator);
  const gap = Number.isFinite(value) && value >= 0 ? countedGap(left, value, pocket.currency) : null;
  const money = (amount: number) => formatMoney(formatCurrency, amount, pocket.currency);
  const isCard = pocket.kind === "card";

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <Text style={[styles.sub, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.left", { amount: money(left) })}</Text>
      <AuraField
        large
        autoFocus
        label={t(isCard ? "forex.countCardLabel" : "forex.countLabel", { currency: pocket.currency })}
        value={counted}
        onChangeText={(text) => setCounted(text.replace(/[^0-9.,]/g, ""))}
        placeholder={`0${separator}00`}
        keyboardType="decimal-pad"
      />
      {gap === null ? null : gap === 0 ? (
        <Text style={[styles.note, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.countMatch")}</Text>
      ) : gap > 0 ? (
        <>
          <Text style={[styles.note, { color: c.text, fontFamily: f.medium }]}>{t("forex.countGap", { amount: money(gap) })}</Text>
          <AuraButton
            label={t("forex.countLog", { amount: money(gap) })}
            icon="check"
            onPress={() => {
              logUntrackedCash(pocket, gap);
              onDone();
            }}
          />
        </>
      ) : (
        <Text style={[styles.note, { color: auraSignal.amber, fontFamily: f.regular }]}>{t("forex.countExtra", { amount: money(-gap) })}</Text>
      )}
      <AuraButton label={t("common.back")} variant="ghost" size="md" onPress={onBack} />
    </ScrollView>
  );
}

function LeftoverStep({ pocket, left, rate, onBack, onDone }: { pocket: ForexPocket; left: number; rate: number; onBack: () => void; onDone: () => void }) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const separator = useMemo(() => localeDecimalSeparator(locale), [locale]);
  const leftover = Math.max(0, left);
  const [choice, setChoice] = useState<PocketCloseKind | null>(null);
  const [received, setReceived] = useState("");
  const receivedValue = parseAmountInput(received, separator);
  const result = receivedValue >= 0 ? conversionResult({ leftover, rate, received: receivedValue, homeCurrency: pocket.homeCurrency }) : null;
  const home = (amount: number) => formatMoney(formatCurrency, amount, pocket.homeCurrency);

  const options: { kind: PocketCloseKind; label: string; detail: string; icon: IconName }[] = [
    { kind: "kept", label: t("forex.keep"), detail: t("forex.keepDetail"), icon: "wallet" },
    { kind: "converted", label: t("forex.converted"), detail: t("forex.convertedDetail"), icon: "swap" },
    { kind: "writtenOff", label: t("forex.spentAll"), detail: t("forex.spentAllDetail"), icon: "receipt" },
  ];
  const canSave = choice !== null && (choice !== "converted" || (Number.isFinite(receivedValue) && receivedValue >= 0));

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <View>
        <Text style={[styles.loadTitle, { color: c.text, fontFamily: f.semibold }]}>{t("forex.leftover")}</Text>
        <Text style={[styles.sub, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.left", { amount: formatMoney(formatCurrency, leftover, pocket.currency) })}</Text>
      </View>
      <View style={styles.options}>
        {options.map((option) => {
          const selected = option.kind === choice;
          return (
            <PressableScale
              key={option.kind}
              onPress={() => setChoice(option.kind)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.option, { backgroundColor: selected ? c.surfaceStrong : c.surface, borderColor: selected ? c.text : c.hairline }]}
            >
              <Icon name={option.icon} size={18} color={c.text} />
              <View style={styles.loadText}>
                <Text style={[styles.loadTitle, { color: c.text, fontFamily: f.semibold }]}>{option.label}</Text>
                <Text style={[styles.note, { color: c.textSoft, fontFamily: f.regular }]}>{option.detail}</Text>
              </View>
            </PressableScale>
          );
        })}
      </View>
      {choice === "converted" ? (
        <View style={styles.group}>
          <AuraField
            label={t("forex.received", { currency: pocket.homeCurrency })}
            value={received}
            onChangeText={(text) => setReceived(text.replace(/[^0-9.,]/g, ""))}
            placeholder={`0${separator}00`}
            keyboardType="decimal-pad"
            autoFocus
          />
          {result !== null && Number.isFinite(result) && received.trim() ? (
            <Text style={[styles.note, { color: result > 0 ? auraSignal.amber : c.textSoft, fontFamily: f.medium }]}>
              {result > 0 ? t("forex.loss", { amount: home(result) }) : result < 0 ? t("forex.gain", { amount: home(-result) }) : t("forex.even")}
            </Text>
          ) : null}
        </View>
      ) : null}
      <AuraButton
        label={t("forex.confirm")}
        icon="check"
        disabled={!canSave}
        onPress={() => {
          if (!choice) return;
          closePocket(pocket, choice, choice === "converted" ? receivedValue : 0);
          onDone();
        }}
      />
      <AuraButton label={t("common.back")} variant="ghost" size="md" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 16, gap: 18 },
  left: { fontSize: 34, letterSpacing: -1 },
  sub: { fontSize: 14.5, marginTop: 2 },
  progress: { marginTop: 12 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  group: { gap: 8 },
  label: { fontSize: 13.5 },
  load: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  loadText: { flex: 1 },
  loadTitle: { fontSize: 14.5 },
  actions: { marginTop: 0 },
  options: { gap: 10 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
});
