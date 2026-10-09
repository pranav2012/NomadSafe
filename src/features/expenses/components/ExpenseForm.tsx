import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import {
  AuraButton,
  AuraChip,
  AuraDateField,
  AuraField,
  AuraOptionSheet,
  AuraSheet,
  Icon,
  PressableScale,
  showAlert,
  useAura,
  showToast,
} from "@/atoms";
import { auraCategoryColors, auraHitSlop, auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { CURRENCY_OPTIONS } from "@/utils/currency";
import { isArchivedGroup, findMoneyGroup, isTrip, selectMoneyGroups, useTripsStore } from "@/features/trips/store/tripsStore";
import { useRecurringStore } from "@/features/expenses/store/recurringStore";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import type { RepeatFrequency } from "@/features/expenses/utils/recurring";
import { usePlanStore, usePlusGate } from "@/modules/billing";
import { aiService, type ReceiptItems } from "@/modules/ai";
import { ocr } from "@/modules/ocr";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { withSystemPrompt } from "@/utils/systemPrompt";
import { guessReceipt } from "@/features/expenses/utils/receiptText";
import { ReceiptItemsSheet } from "@/features/expenses/components/ReceiptItemsSheet";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/features/expenses/constants/categories";
import { type Expense, type ExpenseLocation, type ExpenseSource, useExpensesStore } from "@/features/expenses/store/expensesStore";
import { roundMoney, SELF_ID, type ExpenseShare, type ExpensePayer, type ExpenseSplit, splitByUnits } from "@/features/expenses/utils/split";
import { initialSplitValue, personLabel, SplitEditor, splitValueToPayers, splitValueToShares, splitValueToStored, type SplitValue } from "@/features/expenses/components/SplitEditor";
import { categorizeHeuristic } from "@/features/expenses/services/categorizer";
import { getCurrentExpenseLocation } from "@/features/expenses/services/locationTagging";
import { useGmailStatus } from "@/features/expenses/hooks/useGmailStatus";
import { localeDecimalSeparator, parseAmountInput } from "@/features/expenses/utils/amountInput";
import { track, PrivateView } from "@/modules/analytics";
import { pocketOfExpense } from "@/features/expenses/services/forexPockets";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";
import { defaultPocketFor, payablePockets, pocketBalance, type ForexPocket } from "@/features/expenses/utils/forex";
import { formatMoney } from "@/features/expenses/utils/money";
import { showInterstitial } from "@/modules/ads";

export interface ExpenseDraftValues {
  amount: number;
  currency: string;
  merchant: string;
  category: ExpenseCategory;
  date: string;
  paidBy?: string;
  payers?: ExpensePayer[];
  shares?: ExpenseShare[];
  split?: ExpenseSplit;
  rawText?: string;
  /** Forex pocket it was paid from (voice: "paid cash"). */
  pocketId?: string | null;
}

export interface ExpenseFormProps {
  editingExpense?: Expense | null;
  /** Prefills a new spend (e.g. from voice). */
  initialDraft?: ExpenseDraftValues;
  source?: ExpenseSource;
  /** The trip or group a new spend goes to (null: not in a group); the "In" picker can change it. */
  groupId: string | null;
  /** Currency for a new spend; defaults to the trip or group's, else yours. */
  tripCurrency?: string;
  /** Overrides the people of the trip or group (voice). */
  companions?: string[];
  onSave: () => void;
  onCancel: () => void;
  onSpeak?: () => void;
  /** Shows Gmail / paste shortcuts above a new spend; the parent opens the import sheet. */
  onImport?: (source: "gmail" | "paste") => void;
}

interface ExpenseSheetProps extends ExpenseFormProps {
  visible: boolean;
}

function getCurrencyAffix(locale: string, currency: string) {
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(1);
    const numberIndex = formatted.search(/\d/);
    const symbol = formatted.replace(/[\d\s.,٬٫'’]/g, "").trim() || currency;
    const symbolIndex = formatted.indexOf(symbol);
    return {
      prefix: symbolIndex >= 0 && symbolIndex < numberIndex ? symbol : undefined,
      suffix: symbolIndex > numberIndex ? symbol : undefined,
    };
  } catch {
    return { prefix: currency, suffix: undefined };
  }
}

/**
 * Add or edit a spend in an Aura sheet. The form body only mounts while the sheet is open, so each
 * open starts from the given expense or draft.
 */
export function ExpenseForm({ visible, ...props }: ExpenseSheetProps) {
  const { t } = useLocalization();
  const { c } = useAura();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteExpense = useExpensesStore((state) => state.deleteExpense);
  const editing = props.editingExpense;

  return (
    <>
      <AuraSheet
        visible={visible}
        onClose={props.onCancel}
        full
        title={editing ? t("expenses.editTitle") : t("expenses.addTitle")}
        headerAction={
          props.onSpeak && !editing ? (
            <PressableScale
              onPress={props.onSpeak}
              hitSlop={auraHitSlop(34)}
              accessibilityRole="button"
              accessibilityLabel={t("voiceExpense.speakToAdd")}
              style={[styles.mic, { backgroundColor: c.surfaceStrong }]}
            >
              <Icon name="mic" size={16} color={c.text} />
            </PressableScale>
          ) : null
        }
      >
        <ExpenseFormBody {...props} onDelete={() => setDeleteOpen(true)} />
      </AuraSheet>
      <AuraSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("expenses.deleteTitle")}
        footer={
          <View style={styles.actions}>
            <AuraButton label={t("common.cancel")} variant="secondary" onPress={() => setDeleteOpen(false)} style={styles.flex} />
            <AuraButton
              label={t("common.delete")}
              variant="danger"
              icon="trash"
              onPress={() => {
                if (editing) deleteExpense(editing.id);
                setDeleteOpen(false);
                props.onSave();
              }}
              style={styles.flex}
            />
          </View>
        }
      >
        <Text style={[styles.confirmBody, { color: c.textSoft }]}>{editing ? t("expenses.deleteBody", { merchant: editing.merchant }) : ""}</Text>
      </AuraSheet>
    </>
  );
}

function ExpenseFormBody({
  editingExpense,
  initialDraft,
  source = "manual",
  groupId,
  tripCurrency,
  companions: companionsOverride,
  onSave,
  onImport,
  onDelete,
}: ExpenseFormProps & { onDelete: () => void }) {
  const { c, f } = useAura();
  const { t, locale, currency: defaultCurrency, formatCurrency } = useLocalization();
  const [targetId, setTargetId] = useState<string | null>(editingExpense ? editingExpense.groupId : groupId);
  const target = useTripsStore((state) => findMoneyGroup(state, targetId));
  const allGroups = useTripsStore(selectMoneyGroups);
  const companions = useMemo(() => companionsOverride ?? target?.companions ?? [], [companionsOverride, target?.companions]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repeat, setRepeat] = useState<RepeatFrequency | null>(null);
  const [receiptLines, setReceiptLines] = useState<string[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [readingItems, setReadingItems] = useState(false);
  const [receiptItems, setReceiptItems] = useState<ReceiptItems | null>(null);
  const router = useRouter();
  const cloudAi = usePlanStore((state) => state.cloudAi);
  const plus = usePlusGate();
  const canRepeat = !editingExpense && source === "manual";
  const [currencyTouched, setCurrencyTouched] = useState(Boolean(editingExpense ?? initialDraft));
  const addExpense = useExpensesStore((state) => state.addExpense);
  const updateExpense = useExpensesStore((state) => state.updateExpense);

  const decimalSeparator = useMemo(() => localeDecimalSeparator(locale), [locale]);
  const prefill = editingExpense ?? initialDraft;
  const [amount, setAmount] = useState(prefill ? String(prefill.amount).replace(".", decimalSeparator) : "");
  const [merchant, setMerchant] = useState(prefill?.merchant ?? "");
  const [missing, setMissing] = useState<{ amount: boolean; merchant: boolean }>({ amount: false, merchant: false });
  const [category, setCategory] = useState<ExpenseCategory>(prefill?.category ?? "other");
  const [categoryTouched, setCategoryTouched] = useState(Boolean(prefill));
  const [currency, setCurrency] = useState(prefill?.currency ?? tripCurrency ?? target?.currency ?? defaultCurrency);
  const [note, setNote] = useState(editingExpense?.note ?? "");
  const pockets = usePocketsStore((state) => state.pockets);
  const allExpenses = useExpensesStore((state) => state.expenses);
  const [editingPocket] = useState(() => (editingExpense ? pocketOfExpense(usePocketsStore.getState().pockets, editingExpense.id) : null));
  const [pocketId, setPocketId] = useState<string | null>(() => {
    if (editingExpense) return editingPocket?.id ?? null;
    if (initialDraft?.pocketId !== undefined) return initialDraft.pocketId;
    return plus.isPlus ? (defaultPocketFor(usePocketsStore.getState().pockets, targetId, currency)?.id ?? null) : null;
  });
  const [pocketTouched, setPocketTouched] = useState(Boolean(editingExpense) || initialDraft?.pocketId !== undefined);
  const [date, setDate] = useState<Date>(prefill ? new Date(prefill.date) : new Date());
  // Companions removed from the trip still show if an existing split names them.
  const everyone = useMemo(
    () => [
      ...new Set([
        SELF_ID,
        ...companions,
        ...(prefill?.shares ?? []).map((share) => share.person),
        ...(prefill?.payers ?? []).map((payer) => payer.person),
        ...(prefill?.paidBy ? [prefill.paidBy] : []),
      ]),
    ],
    [companions, prefill],
  );
  // A new spend with people is split equally with everyone until changed.
  const defaultSplit = (people: string[]): SplitValue => {
    const base = initialSplitValue(people, decimalSeparator);
    return people.length > 1 ? { ...base, mode: "equal", people } : base;
  };
  const [split, setSplit] = useState<SplitValue>(() => {
    const hint = editingExpense?.splitHint;
    // A Gmail split suggestion: prefill the proposed shares, or start with the known people selected.
    if (hint?.shares) return initialSplitValue(everyone, decimalSeparator, { paidBy: SELF_ID, shares: hint.shares, currency: editingExpense?.currency ?? currency });
    if (hint) return { ...initialSplitValue(everyone, decimalSeparator), mode: "equal", people: hint.people };
    if (!prefill) return defaultSplit(everyone);
    return initialSplitValue(everyone, decimalSeparator, { ...prefill });
  });
  const [splitOpen, setSplitOpen] = useState(split.multiPay || split.mode === "custom" || split.mode === "percent" || split.mode === "shares");
  const canSplit = everyone.length > 1;

  const chooseTarget = (value: string) => {
    const nextId = value === NO_GROUP ? null : value;
    if (nextId === targetId) return;
    setTargetId(nextId);
    const next = nextId ? allGroups.find((group) => group.id === nextId) : null;
    const nextCurrency = currencyTouched ? currency : (next?.currency ?? defaultCurrency);
    if (!currencyTouched) setCurrency(nextCurrency);
    if (!pocketTouched && plus.isPlus) setPocketId(defaultPocketFor(pockets, nextId, nextCurrency)?.id ?? null);
    else if (pocketId && !pockets.some((pocket) => pocket.id === pocketId && pocket.groupId === nextId)) setPocketId(null);
    setSplit(defaultSplit([SELF_ID, ...(next?.companions ?? [])]));
    setSplitOpen(false);
  };
  const targetOptions = [
    { value: NO_GROUP, label: t("money.notInGroup") },
    ...allGroups
      .filter((group) => !isArchivedGroup(group) || group.id === targetId)
      .map((group) => ({ value: group.id, label: isTrip(group) ? group.name : `${group.emoji ?? "👥"} ${group.name}`, detail: isTrip(group) ? t("money.tripBadge") : undefined })),
  ];
  const showTarget = source !== "voice" && !companionsOverride;
  const [location, setLocation] = useState<ExpenseLocation | null>(editingExpense?.location ?? null);
  const [isLocating, setIsLocating] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const affix = useMemo(() => getCurrencyAffix(locale, currency), [locale, currency]);

  // Auto-suggest a category from the merchant until the user picks one.
  const handleMerchantChange = (value: string) => {
    setMerchant(value);
    setMissing((current) => (current.merchant ? { ...current, merchant: false } : current));
    if (!categoryTouched) {
      const guess = categorizeHeuristic({ merchant: value });
      if (guess.matched) setCategory(guess.category);
    }
  };

  const handleToggleLocation = async () => {
    if (location) {
      setLocation(null);
      return;
    }
    setIsLocating(true);
    const result = await getCurrentExpenseLocation();
    setIsLocating(false);
    if (result) setLocation(result);
    else showAlert(t("expenses.tagLocation"), t("expenses.locationUnavailable"));
  };

  const scanReceipt = () =>
    plus.run("receiptScan", () => {
      void (async () => {
        if (!ocr.isAvailable) {
          showAlert(t("receipt.unavailableTitle"), t("receipt.unavailableBody"));
          return;
        }
        const picked = await withSystemPrompt(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 }));
        if (picked.canceled || !picked.assets[0]) return;
        setScanning(true);
        try {
          const lines = await ocr.readLines(picked.assets[0].uri);
          const guess = guessReceipt(lines);
          if (guess.amount !== null) setAmount(String(guess.amount).replace(".", decimalSeparator));
          if (guess.merchant && !merchant.trim()) handleMerchantChange(guess.merchant);
          if (guess.date) setDate(new Date(`${guess.date}T12:00:00`));
          setReceiptLines(lines);
          track("receipt_scanned", { found_total: guess.amount !== null, lines: Math.min(lines.length, 200) });
          if (guess.amount === null) showToast(t("receipt.noTotal"));
        } catch {
          showAlert(t("receipt.failed"));
        } finally {
          setScanning(false);
        }
      })();
    });

  const splitByItem = () => {
    if (!receiptLines) return;
    if (!cloudAi) {
      router.push({ pathname: "/paywall", params: { reason: "ai" } });
      return;
    }
    setReadingItems(true);
    aiService
      .readReceiptItems(receiptLines)
      .then((items) => {
        setReceiptItems(items);
        if (!Number.isFinite(parseAmountInput(amount, decimalSeparator))) setAmount(String(items.total).replace(".", decimalSeparator));
      })
      .catch(() => showAlert(t("receipt.itemsFailedTitle"), t("receipt.itemsFailedBody")))
      .finally(() => setReadingItems(false));
  };

  const applyItemWeights = (weights: Record<string, number>) => {
    const parsed = parseAmountInput(amount, decimalSeparator);
    const total = Number.isFinite(parsed) && parsed > 0 ? parsed : (receiptItems?.total ?? 0);
    const resolution = splitByUnits(total, currency, weights);
    if (!resolution.ok) return;
    const custom = Object.fromEntries(resolution.shares.map((share) => [share.person, String(share.amount).replace(".", decimalSeparator)]));
    setSplit({ ...split, mode: "custom", custom });
    setSplitOpen(true);
    track("receipt_items_split", { items: receiptItems?.items.length ?? 0, people: resolution.shares.length });
  };

  const youPay = split.multiPay ? Number(parseAmountInput(split.payers[SELF_ID] ?? "", decimalSeparator)) > 0 : !canSplit || split.paidBy === SELF_ID;
  const pocketChoices = [
    ...payablePockets(pockets, targetId),
    ...(editingPocket && editingPocket.closed && editingPocket.groupId === targetId ? [editingPocket] : []),
  ];
  const showPaidWith = pocketChoices.length > 0 && youPay && (plus.isPlus || editingPocket !== null);
  const choosePocket = (pocket: ForexPocket | null) =>
    plus.run("forex", () => {
      setPocketTouched(true);
      setPocketId(pocket?.id ?? null);
      if (pocket) {
        setCurrency(pocket.currency);
        setCurrencyTouched(true);
      }
    });

  const handleSave = () => {
    const parsedAmount = parseAmountInput(amount, decimalSeparator);
    const numericAmount = Number.isFinite(parsedAmount) ? roundMoney(parsedAmount, currency) : parsedAmount;
    const trimmedMerchant = merchant.trim();
    const amountMissing = !Number.isFinite(numericAmount) || numericAmount <= 0;
    if (amountMissing || !trimmedMerchant) {
      setMissing({ amount: amountMissing, merchant: !trimmedMerchant });
      return;
    }
    const resolution = canSplit ? splitValueToShares(split, numericAmount, currency, decimalSeparator) : null;
    if (resolution && !resolution.ok) {
      showAlert(t("split.invalidTitle"), t(`split.invalid.${resolution.reason}`));
      return;
    }
    const shares = resolution?.ok ? resolution.shares.filter((share) => share.amount > 0) : undefined;
    const payerResolution = shares ? splitValueToPayers(split, numericAmount, currency, decimalSeparator) : null;
    if (payerResolution && !payerResolution.ok) {
      showAlert(t("split.invalidTitle"), t("split.invalid.payers-total"));
      return;
    }
    const payers = payerResolution?.ok ? payerResolution.payers : undefined;
    const payload = {
      groupId: targetId,
      merchant: trimmedMerchant,
      amount: numericAmount,
      currency,
      category,
      note: note.trim() || undefined,
      date: date.toISOString(),
      location,
      paidBy: shares && !payers ? split.paidBy : undefined,
      payers,
      shares,
      split: shares ? splitValueToStored(split, decimalSeparator) : undefined,
      splitHint: undefined,
    };
    const paidFrom = showPaidWith && pocketChoices.some((pocket) => pocket.id === pocketId && pocket.currency === currency) ? pocketId : null;
    if (editingExpense) {
      updateExpense(editingExpense.id, payload);
      if ((editingPocket?.id ?? null) !== paidFrom) usePocketsStore.getState().setSpend(editingExpense.id, paidFrom);
    } else {
      const added = addExpense({ ...payload, source, rawText: initialDraft?.rawText, autoCategorized: false });
      if (paidFrom) {
        usePocketsStore.getState().setSpend(added.id, paidFrom);
        const kind = pockets.find((pocket) => pocket.id === paidFrom)?.kind ?? "cash";
        track("forex_spend_paid", { source: source === "voice" ? "voice" : "manual", kind });
      }
      if (repeat && canRepeat) {
        const day = toLocalDayKey(payload.date);
        useRecurringStore.getState().add({
          groupId: targetId,
          frequency: repeat,
          startDate: day,
          lastAddedDate: day,
          template: {
            merchant: payload.merchant,
            amount: payload.amount,
            currency: payload.currency,
            category: payload.category,
            note: payload.note,
            paidBy: payload.paidBy,
            payers: payload.payers,
            shares: payload.shares,
            split: payload.split,
          },
        });
        track("recurring_created", { frequency: repeat });
      }
      track("expense_added", { source: source === "voice" ? "voice" : "manual", count: 1 });
    }
    onSave();
    if (!editingExpense && source !== "voice") showInterstitial("expense_saved");
  };

  const affixText = (text: string) => <Text style={[styles.affix, { color: c.textSoft, fontFamily: f.semibold }]}>{text}</Text>;

  return (
    <PrivateView style={styles.flex}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {onImport && !editingExpense && !initialDraft ? <ImportShortcuts onImport={onImport} /> : null}
        {canRepeat ? (
          <PressableScale
            onPress={scanReceipt}
            disabled={scanning}
            accessibilityRole="button"
            style={[styles.scan, { backgroundColor: c.surface, borderColor: c.hairline }]}
          >
            <Icon name={plus.isPlus ? "receipt" : "lock"} size={16} color={c.text} />
            <Text style={[styles.scanText, { color: c.text, fontFamily: f.medium }]}>{scanning ? t("receipt.reading") : t("receipt.scan")}</Text>
            {scanning ? <ActivityIndicator size="small" color={c.textSoft} /> : null}
          </PressableScale>
        ) : null}
        {showTarget ? (
          <PressableScale
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("money.inLabel", { name: target?.name ?? t("money.notInGroup") })}
            style={[styles.target, { backgroundColor: c.surfaceStrong }]}
          >
            <Text style={[styles.targetLabel, { color: c.textSoft, fontFamily: f.regular }]}>{t("money.in")}</Text>
            <Text style={[styles.targetName, { color: c.text, fontFamily: f.semibold }]} numberOfLines={1}>
              {target ? (isTrip(target) ? target.name : `${target.emoji ?? "👥"} ${target.name}`) : t("money.notInGroup")}
            </Text>
            <Icon name="chevronDown" size={12} color={c.textMuted} />
          </PressableScale>
        ) : null}
        <AuraField
          large
          label={t("expenses.amount")}
          labelAction={
            <PressableScale onPress={() => setIsCurrencyOpen((open) => !open)} hitSlop={8} style={[styles.currency, { backgroundColor: c.surfaceStrong }]}>
              <Text style={[styles.currencyText, { color: c.text, fontFamily: f.semibold }]}>{currency}</Text>
              <Icon name="chevronDown" size={12} color={c.textMuted} />
            </PressableScale>
          }
          value={amount}
          onChangeText={(value) => {
            setAmount(value.replace(/[^0-9.,]/g, ""));
            setMissing((current) => (current.amount ? { ...current, amount: false } : current));
          }}
          error={missing.amount ? t("expenses.amountMissing") : null}
          placeholder={`0${decimalSeparator}00`}
          keyboardType="decimal-pad"
          autoFocus={!prefill}
          prefix={affix.prefix ? affixText(affix.prefix) : undefined}
          suffix={affix.suffix ? affixText(affix.suffix) : undefined}
        />
        {isCurrencyOpen ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} layout={LinearTransition} style={styles.wrap}>
            {CURRENCY_OPTIONS.map((option) => (
              <AuraChip
                key={option.code}
                label={option.code}
                selected={option.code === currency}
                onPress={() => {
                  setCurrency(option.code);
                  setCurrencyTouched(true);
                  setIsCurrencyOpen(false);
                  if (!pocketTouched && plus.isPlus) setPocketId(defaultPocketFor(pockets, targetId, option.code)?.id ?? null);
                  else if (pocketId && pockets.find((pocket) => pocket.id === pocketId)?.currency !== option.code) setPocketId(null);
                }}
              />
            ))}
          </Animated.View>
        ) : null}

        {showPaidWith ? (
          <View style={styles.group}>
            <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("forex.paidWith")}</Text>
            <View style={styles.wrap}>
              <AuraChip label={t("forex.paidWithCard")} selected={pocketId === null} onPress={() => choosePocket(null)} />
              {pocketChoices.map((pocket) => (
                <AuraChip
                  key={pocket.id}
                  icon={pocket.kind === "card" ? "creditCard" : "banknote"}
                  label={`${t(pocket.kind === "card" ? "forex.kindCard" : "forex.kindCash")} · ${t("forex.paidWithLeft", {
                    amount: formatMoney(formatCurrency, pocketBalance(pocket, allExpenses).left, pocket.currency),
                  })}`}
                  selected={pocket.id === pocketId}
                  onPress={() => choosePocket(pocket)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <AuraField
          label={t("expenses.merchant")}
          value={merchant}
          onChangeText={handleMerchantChange}
          placeholder={t("expenses.merchantPlaceholder")}
          autoCapitalize="words"
          error={missing.merchant ? t("expenses.merchantMissing") : null}
        />

        {receiptLines && canSplit ? (
          <AuraButton
            label={readingItems ? t("receipt.readingItems") : t("receipt.splitByItem")}
            icon={cloudAi ? "receipt" : "lock"}
            variant="secondary"
            size="md"
            loading={readingItems}
            onPress={splitByItem}
            style={styles.itemButton}
          />
        ) : null}
        {canSplit && !splitOpen ? (
          <SplitSummary split={split} everyone={everyone} onOpen={() => setSplitOpen(true)} />
        ) : null}
        {canSplit && splitOpen ? (
          <View style={[styles.splitCard, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <SplitEditor
              everyone={everyone}
              value={split}
              onChange={setSplit}
              amount={parseAmountInput(amount, decimalSeparator)}
              currency={currency}
              decimalSeparator={decimalSeparator}
              groupId={targetId}
            />
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("expenses.categoryLabel")}</Text>
          <View style={styles.wrap}>
            {EXPENSE_CATEGORIES.map((meta) => (
              <AuraChip
                key={meta.id}
                label={t(`expenses.category.${meta.id}`)}
                icon={meta.icon}
                dot={meta.id === category ? undefined : auraCategoryColors[meta.id]}
                selected={meta.id === category}
                onPress={() => {
                  setCategory(meta.id);
                  setCategoryTouched(true);
                }}
              />
            ))}
          </View>
        </View>

        <AuraDateField label={t("expenses.dateLabel")} value={date} onChange={setDate} maximumDate={new Date()} />
        {canRepeat ? (
          <View style={styles.group}>
            <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("expenses.repeat")}</Text>
            <View style={styles.wrap}>
              {([null, "weekly", "monthly", "yearly"] as const).map((option) => (
                <AuraChip
                  key={option ?? "none"}
                  label={t(`expenses.repeatOption.${option ?? "none"}`)}
                  icon={option && !plus.isPlus ? "lock" : undefined}
                  selected={repeat === option}
                  onPress={() => (option ? plus.run("recurring", () => setRepeat(option)) : setRepeat(null))}
                />
              ))}
            </View>
          </View>
        ) : null}
        <AuraField label={t("expenses.noteLabel")} value={note} onChangeText={setNote} placeholder={t("expenses.notePlaceholder")} />

        <PressableScale
          onPress={() => void handleToggleLocation()}
          pressedScale={0.98}
          accessibilityRole="switch"
          accessibilityState={{ checked: Boolean(location) }}
          style={[styles.locationRow, { backgroundColor: c.surface, borderColor: location ? auraSignal.teal : c.hairline }]}
        >
          <Icon name="mapPin" size={16} color={location ? auraSignal.teal : c.textSoft} />
          <Text style={[styles.locationText, { color: c.text, fontFamily: f.medium }]}>
            {isLocating ? t("expenses.locating") : location ? (location.label ?? t("expenses.locationTagged")) : t("expenses.tagLocation")}
          </Text>
          {isLocating ? (
            <ActivityIndicator size="small" color={c.textSoft} />
          ) : (
            <View style={[styles.toggle, { backgroundColor: location ? auraSignal.teal : "transparent", borderColor: location ? auraSignal.teal : c.textMuted }]}>
              {location ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}
            </View>
          )}
        </PressableScale>

      </ScrollView>

      <ReceiptItemsSheet receipt={receiptItems} everyone={everyone} currency={currency} onClose={() => setReceiptItems(null)} onApply={applyItemWeights} />
      <AuraOptionSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={editingExpense ? t("money.moveTo") : t("money.addTo")}
        options={targetOptions}
        selected={targetId ?? NO_GROUP}
        onSelect={chooseTarget}
      />
      <View style={styles.footer}>
        {editingExpense ? <AuraButton label={t("common.delete")} icon="trash" variant="secondary" onPress={onDelete} style={styles.deleteButton} /> : null}
        <AuraButton
          label={editingExpense ? t("expenses.saveAction") : t("expenses.addAction")}
          icon="check"
          onPress={handleSave}
          style={styles.flex}
        />
      </View>
    </PrivateView>
  );
}

/** "Paid by · Split · With" at a glance; tapping opens the full split editor. */
function SplitSummary({ split, everyone, onOpen }: { split: SplitValue; everyone: string[]; onOpen: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const payer = split.multiPay ? t("split.severalPayers") : personLabel(split.paidBy, t);
  const how = t(`split.mode.${split.mode}`);
  const withWhom =
    split.mode === "equal"
      ? split.people.length === everyone.length
        ? t("money.everyone")
        : t("money.people", { count: split.people.length })
      : null;
  const pill = (label: string, value: string) => (
    <PressableScale key={label} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={[styles.pill, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <Text style={[styles.pillLabel, { color: c.textMuted, fontFamily: f.regular }]}>{label}</Text>
      <Text style={[styles.pillValue, { color: c.text, fontFamily: f.semibold }]} numberOfLines={1}>
        {value}
      </Text>
    </PressableScale>
  );
  return (
    <View style={styles.pills}>
      {pill(t("split.paidBy"), payer)}
      {pill(t("split.title"), how)}
      {withWhom ? pill(t("money.with"), withWhom) : null}
    </View>
  );
}

function ImportShortcuts({ onImport }: { onImport: (source: "gmail" | "paste") => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const gmail = useGmailStatus();

  const rows = [
    gmail.configured
      ? {
          source: "gmail" as const,
          icon: "mail" as const,
          title: t("expenses.formImportGmail"),
          detail: gmail.connected && gmail.email ? t("expenses.gmailConnectedAs", { email: gmail.email }) : t("expenses.formImportGmailSub"),
        }
      : null,
    { source: "paste" as const, icon: "messageCircle" as const, title: t("expenses.formPasteAlert"), detail: t("expenses.formPasteAlertSub") },
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <View style={[styles.shortcuts, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      {rows.map((row, index) => (
        <PressableScale
          key={row.source}
          onPress={() => onImport(row.source)}
          pressedScale={0.98}
          accessibilityRole="button"
          accessibilityLabel={row.title}
          style={[styles.shortcut, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline } : null]}
        >
          <View style={[styles.shortcutIcon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name={row.icon} size={16} color={c.text} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.shortcutTitle, { color: c.text, fontFamily: f.medium }]}>{row.title}</Text>
            <Text style={[styles.shortcutDetail, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={1}>
              {row.detail}
            </Text>
          </View>
          <Icon name="chevronRight" size={14} color={c.textMuted} />
        </PressableScale>
      ))}
    </View>
  );
}

const NO_GROUP = "__none__";

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scan: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  scanText: { flex: 1, fontSize: 14.5 },
  itemButton: { alignSelf: "flex-start" },
  target: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", height: 34, paddingHorizontal: 14, borderRadius: 17, maxWidth: "100%" },
  targetLabel: { fontSize: 13.5 },
  targetName: { fontSize: 13.5, flexShrink: 1 },
  pills: { flexDirection: "row", gap: 8 },
  pill: { flex: 1, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  pillLabel: { fontSize: 12 },
  pillValue: { fontSize: 14.5 },
  shortcuts: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  shortcut: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10 },
  shortcutIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  shortcutTitle: { fontSize: 14.5 },
  shortcutDetail: { fontSize: 12.5, marginTop: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, gap: 18 },
  mic: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  currency: { flexDirection: "row", alignItems: "center", gap: 4, height: 28, paddingHorizontal: 10, borderRadius: 14 },
  currencyText: { fontSize: 13 },
  affix: { fontSize: 26 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  group: { gap: 8 },
  label: { fontSize: 13.5 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  locationText: { flex: 1, fontSize: 14.5 },
  toggle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  splitCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  deleteButton: { paddingHorizontal: 18 },
  actions: { flexDirection: "row", gap: 10 },
  confirmBody: { fontSize: 15, lineHeight: 22, paddingHorizontal: 20, paddingBottom: 8 },
});
