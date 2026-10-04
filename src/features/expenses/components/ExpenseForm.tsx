import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraChip } from "@/components/aura/AuraChip";
import { AuraDateField } from "@/components/aura/AuraDateField";
import { AuraField } from "@/components/aura/AuraField";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import { auraCategoryColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { CURRENCY_OPTIONS } from "@/utils/currency";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/features/expenses/constants/categories";
import { type Expense, type ExpenseLocation, type ExpenseSource, useExpensesStore } from "@/features/expenses/store/expensesStore";
import { SELF_ID, type ExpenseShare } from "@/features/expenses/utils/split";
import { initialSplitValue, SplitEditor, splitValueToShares, type SplitValue } from "@/features/expenses/components/SplitEditor";
import { categorizeHeuristic } from "@/features/expenses/services/categorizer";
import { getCurrentExpenseLocation } from "@/features/expenses/services/locationTagging";
import { useGmailStatus } from "@/features/expenses/hooks/useGmailStatus";
import { localeDecimalSeparator, parseAmountInput } from "@/features/expenses/utils/amountInput";
import { track } from "@/services/analytics";

export interface ExpenseDraftValues {
  amount: number;
  currency: string;
  merchant: string;
  category: ExpenseCategory;
  date: string;
  paidBy?: string;
  shares?: ExpenseShare[];
  rawText?: string;
}

export interface ExpenseFormProps {
  editingExpense?: Expense | null;
  /** Prefills a new spend (e.g. from voice). */
  initialDraft?: ExpenseDraftValues;
  source?: ExpenseSource;
  tripId: string | null;
  tripCurrency: string;
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
  tripId,
  tripCurrency,
  companions = [],
  onSave,
  onImport,
  onDelete,
}: ExpenseFormProps & { onDelete: () => void }) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const addExpense = useExpensesStore((state) => state.addExpense);
  const updateExpense = useExpensesStore((state) => state.updateExpense);

  const decimalSeparator = useMemo(() => localeDecimalSeparator(locale), [locale]);
  const prefill = editingExpense ?? initialDraft;
  const [amount, setAmount] = useState(prefill ? String(prefill.amount).replace(".", decimalSeparator) : "");
  const [merchant, setMerchant] = useState(prefill?.merchant ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(prefill?.category ?? "other");
  const [categoryTouched, setCategoryTouched] = useState(Boolean(prefill));
  const [currency, setCurrency] = useState(prefill?.currency ?? tripCurrency);
  const [note, setNote] = useState(editingExpense?.note ?? "");
  const [date, setDate] = useState<Date>(prefill ? new Date(prefill.date) : new Date());
  // Companions removed from the trip still show if an existing split names them.
  const everyone = useMemo(
    () => [
      ...new Set([SELF_ID, ...companions, ...(prefill?.shares ?? []).map((share) => share.person), ...(prefill?.paidBy ? [prefill.paidBy] : [])]),
    ],
    [companions, prefill],
  );
  const [split, setSplit] = useState<SplitValue>(() => {
    const hint = editingExpense?.splitHint;
    // A Gmail split suggestion: prefill the proposed shares, or start with the known people selected.
    if (hint?.shares) return initialSplitValue(everyone, decimalSeparator, { paidBy: SELF_ID, shares: hint.shares, currency: editingExpense?.currency ?? tripCurrency });
    if (hint) return { paidBy: SELF_ID, mode: "equal", people: hint.people, custom: {} };
    return initialSplitValue(everyone, decimalSeparator, prefill ? { ...prefill } : undefined);
  });
  const canSplit = everyone.length > 1;
  const [location, setLocation] = useState<ExpenseLocation | null>(editingExpense?.location ?? null);
  const [isLocating, setIsLocating] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const affix = useMemo(() => getCurrencyAffix(locale, currency), [locale, currency]);

  // Auto-suggest a category from the merchant until the user picks one.
  const handleMerchantChange = (value: string) => {
    setMerchant(value);
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
    else Alert.alert(t("expenses.tagLocation"), t("expenses.locationUnavailable"));
  };

  const handleSave = () => {
    const numericAmount = parseAmountInput(amount, decimalSeparator);
    const trimmedMerchant = merchant.trim();
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !trimmedMerchant) {
      Alert.alert(t("expenses.validationTitle"), t("expenses.validationBody"));
      return;
    }
    const resolution = canSplit ? splitValueToShares(split, numericAmount, currency, decimalSeparator) : null;
    if (resolution && !resolution.ok) {
      Alert.alert(t("split.invalidTitle"), t(`split.invalid.${resolution.reason}`));
      return;
    }
    const shares = resolution?.ok ? resolution.shares.filter((share) => share.amount > 0) : undefined;
    const payload = {
      tripId,
      merchant: trimmedMerchant,
      amount: numericAmount,
      currency,
      category,
      note: note.trim() || undefined,
      date: date.toISOString(),
      location,
      paidBy: shares ? split.paidBy : undefined,
      shares,
      splitHint: undefined,
    };
    if (editingExpense) {
      updateExpense(editingExpense.id, payload);
    } else {
      addExpense({ ...payload, source, rawText: initialDraft?.rawText, autoCategorized: false });
      track("expense_added", { source: source === "voice" ? "voice" : "manual", count: 1 });
    }
    onSave();
  };

  const affixText = (text: string) => <Text style={[styles.affix, { color: c.textSoft, fontFamily: f.semibold }]}>{text}</Text>;

  return (
    <View style={styles.flex}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {onImport && !editingExpense && !initialDraft ? <ImportShortcuts onImport={onImport} /> : null}
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
          onChangeText={(value) => setAmount(value.replace(/[^0-9.,]/g, ""))}
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
                  setIsCurrencyOpen(false);
                }}
              />
            ))}
          </Animated.View>
        ) : null}

        <AuraField label={t("expenses.merchant")} value={merchant} onChangeText={handleMerchantChange} placeholder={t("expenses.merchantPlaceholder")} autoCapitalize="words" />

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
        <AuraField label={t("expenses.noteLabel")} value={note} onChangeText={setNote} placeholder={t("expenses.notePlaceholder")} />

        <PressableScale
          onPress={() => void handleToggleLocation()}
          pressedScale={0.98}
          accessibilityRole="switch"
          accessibilityState={{ checked: Boolean(location) }}
          style={[styles.locationRow, { backgroundColor: c.surface, borderColor: location ? "#22C7B8" : c.hairline }]}
        >
          <Icon name="mapPin" size={16} color={location ? "#22C7B8" : c.textSoft} />
          <Text style={[styles.locationText, { color: c.text, fontFamily: f.medium }]}>
            {isLocating ? t("expenses.locating") : location ? (location.label ?? t("expenses.locationTagged")) : t("expenses.tagLocation")}
          </Text>
          {isLocating ? (
            <ActivityIndicator size="small" color={c.textSoft} />
          ) : (
            <View style={[styles.toggle, { backgroundColor: location ? "#22C7B8" : "transparent", borderColor: location ? "#22C7B8" : c.highlight }]}>
              {location ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}
            </View>
          )}
        </PressableScale>

        {canSplit ? (
          <View style={[styles.splitCard, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <SplitEditor
              everyone={everyone}
              value={split}
              onChange={setSplit}
              amount={parseAmountInput(amount, decimalSeparator)}
              currency={currency}
              decimalSeparator={decimalSeparator}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {editingExpense ? <AuraButton label={t("common.delete")} icon="trash" variant="secondary" onPress={onDelete} style={styles.deleteButton} /> : null}
        <AuraButton
          label={editingExpense ? t("expenses.saveAction") : t("expenses.addAction")}
          icon="check"
          onPress={handleSave}
          style={styles.flex}
        />
      </View>
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
