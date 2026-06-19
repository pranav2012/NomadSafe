import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DatePicker as SwiftDatePicker, Host } from "@expo/ui/swift-ui";
import { datePickerStyle, environment, tint } from "@expo/ui/swift-ui/modifiers";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { CURRENCY_OPTIONS } from "@/utils/currency";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/features/expenses/constants/categories";
import {
  type Expense,
  type ExpenseLocation,
  useExpensesStore,
} from "@/features/expenses/store/expensesStore";
import { categorizeHeuristic } from "@/features/expenses/services/categorizer";
import { getCurrentExpenseLocation } from "@/features/expenses/services/locationTagging";

export interface ExpenseFormProps {
  editingExpense?: Expense | null;
  tripId: string | null;
  tripCurrency: string;
  companions: string[];
  onSave: () => void;
  onCancel: () => void;
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

export function ExpenseForm({
  editingExpense,
  tripId,
  tripCurrency,
  companions,
  onSave,
  onCancel,
}: ExpenseFormProps) {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();
  const addExpense = useExpensesStore((state) => state.addExpense);
  const updateExpense = useExpensesStore((state) => state.updateExpense);
  const deleteExpense = useExpensesStore((state) => state.deleteExpense);

  const [amount, setAmount] = useState(editingExpense ? String(editingExpense.amount) : "");
  const [merchant, setMerchant] = useState(editingExpense?.merchant ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(
    editingExpense?.category ?? "other",
  );
  const [categoryTouched, setCategoryTouched] = useState(Boolean(editingExpense));
  const [currency, setCurrency] = useState(editingExpense?.currency ?? tripCurrency);
  const [note, setNote] = useState(editingExpense?.note ?? "");
  const [date, setDate] = useState<Date>(
    editingExpense ? new Date(editingExpense.date) : new Date(),
  );
  const [splitWith, setSplitWith] = useState<string[]>(editingExpense?.splitWith ?? []);
  const [location, setLocation] = useState<ExpenseLocation | null>(
    editingExpense?.location ?? null,
  );
  const [isLocating, setIsLocating] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const affix = useMemo(() => getCurrencyAffix(locale, currency), [locale, currency]);

  // Auto-suggest a category from the merchant until the user picks one.
  const handleMerchantChange = (value: string) => {
    setMerchant(value);
    if (!categoryTouched) {
      const guess = categorizeHeuristic({ merchant: value });
      if (guess.matched) setCategory(guess.category);
    }
  };

  const handleSelectCategory = (next: ExpenseCategory) => {
    setCategory(next);
    setCategoryTouched(true);
  };

  const toggleSplit = (name: string) => {
    setSplitWith((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  };

  const handleToggleLocation = async () => {
    if (location) {
      setLocation(null);
      return;
    }
    setIsLocating(true);
    const result = await getCurrentExpenseLocation();
    setIsLocating(false);
    if (result) {
      setLocation(result);
    } else {
      Alert.alert(t("expenses.tagLocation"), t("expenses.smsPermissionDenied"));
    }
  };

  const handleSave = () => {
    const numericAmount = Number(amount);
    const trimmedMerchant = merchant.trim();
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !trimmedMerchant) {
      Alert.alert(t("expenses.validationTitle"), t("expenses.validationBody"));
      return;
    }

    const payload = {
      tripId,
      merchant: trimmedMerchant,
      amount: numericAmount,
      currency,
      category,
      note: note.trim() || undefined,
      date: date.toISOString(),
      location,
      splitWith: splitWith.length > 0 ? splitWith : undefined,
    };

    if (editingExpense) {
      updateExpense(editingExpense.id, payload);
    } else {
      addExpense({ ...payload, source: "manual", autoCategorized: false });
    }
    onSave();
  };

  const handleDelete = () => {
    if (!editingExpense) return;
    Alert.alert(
      t("expenses.deleteTitle"),
      t("expenses.deleteBody", { merchant: editingExpense.merchant }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            deleteExpense(editingExpense.id);
            onSave();
          },
        },
      ],
    );
  };

  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  const isIOS = process.env.EXPO_OS === "ios";
  const isAndroid = process.env.EXPO_OS === "android";

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>
            {editingExpense ? t("expenses.editEyebrow") : t("expenses.addEyebrow")}
          </Text>
          <Text style={[styles.title, { color: theme.inkDeep }]}>
            {editingExpense ? t("expenses.editTitle") : t("expenses.addTitle")}
          </Text>
        </View>
        <Pressable
          onPress={onCancel}
          hitSlop={10}
          style={[styles.closeButton, { backgroundColor: theme.paper, borderColor: theme.hairline }]}
        >
          <Icon name="x" size={18} color={theme.inkSoft} />
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
        <View style={styles.group}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: theme.inkMuted }]}>{t("expenses.amount")}</Text>
            <Pressable onPress={() => setIsCurrencyOpen((open) => !open)} hitSlop={8}>
              <Text style={[styles.meta, { color: theme.teal }]}>{currency}</Text>
            </Pressable>
          </View>
          <View style={[styles.inputShell, { backgroundColor: theme.paper, borderColor: theme.hairline }]}>
            {affix.prefix ? (
              <Text style={[styles.affix, { color: theme.inkDeep }]}>{affix.prefix}</Text>
            ) : null}
            <TextInput
              value={amount}
              onChangeText={(value) => setAmount(value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              placeholderTextColor={theme.inkMuted}
              keyboardType="decimal-pad"
              style={[styles.amountInput, { color: theme.inkDeep }]}
            />
            {affix.suffix ? (
              <Text style={[styles.affix, { color: theme.inkDeep }]}>{affix.suffix}</Text>
            ) : null}
          </View>
          {isCurrencyOpen ? (
            <View style={styles.currencyGrid}>
              {CURRENCY_OPTIONS.map((option) => {
                const active = option.code === currency;
                return (
                  <Pressable
                    key={option.code}
                    onPress={() => {
                      setCurrency(option.code);
                      setIsCurrencyOpen(false);
                    }}
                    style={[
                      styles.currencyOption,
                      {
                        backgroundColor: active ? theme.tealSoft : theme.paper,
                        borderColor: active ? theme.teal : theme.hairline,
                      },
                    ]}
                  >
                    <Text style={[styles.currencyCode, { color: theme.inkDeep }]}>{option.code}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.inkMuted }]}>{t("expenses.merchant")}</Text>
          <View style={[styles.inputShell, { backgroundColor: theme.paper, borderColor: theme.hairline }]}>
            <TextInput
              value={merchant}
              onChangeText={handleMerchantChange}
              placeholder={t("expenses.merchantPlaceholder")}
              placeholderTextColor={theme.inkMuted}
              autoCapitalize="words"
              style={[styles.input, { color: theme.inkDeep }]}
            />
          </View>
        </View>

        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.inkMuted }]}>{t("expenses.categoryLabel")}</Text>
          <View style={styles.categoryRow}>
            {EXPENSE_CATEGORIES.map((meta) => {
              const active = meta.id === category;
              const color = theme[meta.color];
              return (
                <Pressable
                  key={meta.id}
                  onPress={() => handleSelectCategory(meta.id)}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: active ? theme[meta.soft] : theme.paper,
                      borderColor: active ? color : theme.hairline,
                    },
                  ]}
                >
                  <Icon name={meta.icon} size={15} color={active ? color : theme.inkSoft} />
                  <Text
                    style={[
                      styles.categoryText,
                      { color: active ? theme.inkDeep : theme.inkSoft },
                    ]}
                  >
                    {t(`expenses.category.${meta.id}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.inkMuted }]}>{t("expenses.dateLabel")}</Text>
          <Pressable
            onPress={() => setIsPickerOpen(true)}
            style={[styles.inputShell, { backgroundColor: theme.paper, borderColor: theme.hairline }]}
          >
            <Icon name="calendar" size={16} color={theme.inkSoft} />
            <Text style={[styles.dateText, { color: theme.inkDeep }]}>{dateLabel}</Text>
          </Pressable>
          {isAndroid && isPickerOpen ? (
            <DateTimePicker
              value={date}
              mode="date"
              display="default"
              presentation="dialog"
              accentColor={theme.teal}
              positiveButton={{ label: t("common.ok") }}
              negativeButton={{ label: t("common.cancel") }}
              onDismiss={() => setIsPickerOpen(false)}
              onValueChange={(_, selected) => {
                setDate(selected);
                setIsPickerOpen(false);
              }}
            />
          ) : null}
        </View>

        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.inkMuted }]}>{t("expenses.noteLabel")}</Text>
          <View style={[styles.inputShell, { backgroundColor: theme.paper, borderColor: theme.hairline }]}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t("expenses.notePlaceholder")}
              placeholderTextColor={theme.inkMuted}
              style={[styles.input, { color: theme.inkDeep }]}
            />
          </View>
        </View>

        <Pressable
          onPress={handleToggleLocation}
          style={[
            styles.locationRow,
            {
              backgroundColor: location ? theme.tealSoft : theme.paper,
              borderColor: location ? theme.teal : theme.hairline,
            },
          ]}
        >
          <Icon name="mapPin" size={16} color={location ? theme.teal : theme.inkSoft} />
          <Text style={[styles.locationText, { color: theme.inkDeep }]}>
            {isLocating
              ? t("expenses.locating")
              : location
                ? location.label ?? t("expenses.locationTagged")
                : t("expenses.tagLocation")}
          </Text>
          {isLocating ? (
            <ActivityIndicator size="small" color={theme.teal} />
          ) : (
            <View
              style={[
                styles.toggle,
                {
                  backgroundColor: location ? theme.teal : "transparent",
                  borderColor: location ? theme.teal : theme.hairline,
                },
              ]}
            >
              {location ? <Icon name="check" size={12} color={theme.inverse} strokeWidth={3} /> : null}
            </View>
          )}
        </Pressable>

        {companions.length > 0 ? (
          <View style={styles.group}>
            <Text style={[styles.label, { color: theme.inkMuted }]}>{t("expenses.splitWith")}</Text>
            <View style={styles.categoryRow}>
              {companions.map((name) => {
                const active = splitWith.includes(name);
                return (
                  <Pressable
                    key={name}
                    onPress={() => toggleSplit(name)}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: active ? theme.mustardSoft : theme.paper,
                        borderColor: active ? theme.mustard : theme.hairline,
                      },
                    ]}
                  >
                    <Icon name="users" size={14} color={active ? theme.mustard : theme.inkSoft} />
                    <Text style={[styles.categoryText, { color: active ? theme.inkDeep : theme.inkSoft }]}>
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={handleSave}
        style={({ pressed }) => [styles.saveButton, { backgroundColor: theme.teal, opacity: pressed ? 0.9 : 1 }]}
      >
        <Icon name="check" size={18} color={theme.inverse} />
        <Text style={[styles.saveText, { color: theme.inverse }]}>
          {editingExpense ? t("expenses.saveAction") : t("expenses.addAction")}
        </Text>
      </Pressable>

      {editingExpense ? (
        <Pressable onPress={handleDelete} style={styles.deleteButton}>
          <Icon name="trash" size={15} color={theme.stamp} />
          <Text style={[styles.deleteText, { color: theme.stamp }]}>{t("common.delete")}</Text>
        </Pressable>
      ) : null}

      {isIOS ? (
        <Modal visible={isPickerOpen} transparent animationType="slide" onRequestClose={() => setIsPickerOpen(false)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setIsPickerOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
            <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: theme.inkDeep }]}>{dateLabel}</Text>
              <Pressable
                onPress={() => setIsPickerOpen(false)}
                style={[styles.doneButton, { backgroundColor: theme.tealSoft }]}
              >
                <Text style={[styles.doneText, { color: theme.teal }]}>{t("common.ok")}</Text>
              </Pressable>
            </View>
            <Host
              matchContents={{ vertical: true }}
              colorScheme={isDark ? "dark" : "light"}
              ignoreSafeArea="all"
              style={styles.host}
            >
              <SwiftDatePicker
                selection={date}
                displayedComponents={["date"]}
                onDateChange={setDate}
                modifiers={[
                  datePickerStyle("graphical"),
                  tint(theme.teal),
                  environment("colorScheme", isDark ? "dark" : "light"),
                ]}
              />
            </Host>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120, gap: 16 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: { fontFamily: NOMAD_FONTS.display, fontSize: 30, lineHeight: 34, marginTop: 4 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  group: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  meta: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 11, letterSpacing: 0.8 },
  inputShell: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  affix: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 18 },
  amountInput: { flex: 1, minHeight: 50, fontFamily: NOMAD_FONTS.uiSemi, fontSize: 22 },
  input: { flex: 1, minHeight: 50, fontFamily: NOMAD_FONTS.ui, fontSize: 15 },
  dateText: { flex: 1, fontFamily: NOMAD_FONTS.ui, fontSize: 15 },
  currencyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  currencyOption: {
    minWidth: 64,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: "center",
  },
  currencyCode: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  categoryText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  locationText: { flex: 1, fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  toggle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    paddingVertical: 16,
  },
  saveText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 15 },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 4,
  },
  deleteText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 34,
    paddingTop: 12,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sheetTitle: { fontFamily: NOMAD_FONTS.display, fontSize: 22 },
  doneButton: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  doneText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  host: { minHeight: 360 },
});
