import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { localModelService, useModelDownload } from "@/features/ai";
import type { TripBudgetEstimate } from "@/features/ai/services/localModelService";
import { useSettingsStore } from "@/features/settings";
import {
  type DestinationOption,
  normalizeSearchText,
  searchOfflineDestinations,
} from "@/features/trips/data/destinations";
import {
  type CreateTripInput,
  type Trip,
  type TripMode,
  type UpdateTripInput,
  useTripsStore,
} from "@/features/trips/store/tripsStore";
import { geocodeDestinations } from "@/features/trips/services/geocoding";
import { useLocalization } from "@/localization";
import { useTheme } from "@/hooks/useTheme";
import { CURRENCY_OPTIONS } from "@/utils/currency";

type DateField = "start" | "end";

interface FormState {
  name: string;
  destinationQuery: string;
  destinations: string[];
  startDate: Date;
  endDate: Date;
  mode: TripMode;
  budget: string;
  currency: string;
  travelerName: string;
  companions: string[];
}

interface WebDestinationResult {
  display_name: string;
  type?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    country?: string;
  };
}

export interface TripFormProps {
  editingTrip?: Trip | null;
  onSave: () => void;
  onCancel?: () => void;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function countInclusiveDays(startDate: Date, endDate: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return Math.max(1, Math.round((end - start) / msPerDay) + 1);
}

function formatDatePart(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(locale, options).format(date);
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

function makeInitialForm(currency: string, seed?: Partial<FormState>): FormState {
  const startDate = startOfLocalDay(new Date());
  return {
    name: "",
    destinationQuery: "",
    destinations: [],
    startDate,
    endDate: addDays(startDate, 6),
    mode: "solo",
    budget: "",
    currency,
    travelerName: "",
    companions: [],
    ...seed,
  };
}

function tripToFormState(trip: Trip): FormState {
  return {
    name: trip.name,
    destinationQuery: "",
    destinations: trip.destinations,
    startDate: fromDateKey(trip.startDate),
    endDate: fromDateKey(trip.endDate),
    mode: trip.mode,
    budget: String(trip.budget),
    currency: trip.currency,
    travelerName: "",
    companions: trip.companions,
  };
}

function formatWebDestination(result: WebDestinationResult) {
  const city =
    result.address?.city ??
    result.address?.town ??
    result.address?.village ??
    result.address?.municipality;
  const parts = [city, result.address?.state, result.address?.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : result.display_name.split(",").slice(0, 3).join(",");
}

export function TripForm({ editingTrip, onSave, onCancel }: TripFormProps) {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t, locale, formatCurrency } = useLocalization();
  const defaultCurrency = useSettingsStore((state) => state.defaultCurrency);
  const createTrip = useTripsStore((state) => state.createTrip);
  const updateTrip = useTripsStore((state) => state.updateTrip);

  const initialForm = useMemo(
    () =>
      editingTrip
        ? tripToFormState(editingTrip)
        : makeInitialForm(defaultCurrency),
    [editingTrip, defaultCurrency],
  );

  const [form, setForm] = useState<FormState>(initialForm);
  const [pickerField, setPickerField] = useState<DateField | null>(null);
  const [isCurrencyPickerOpen, setIsCurrencyPickerOpen] = useState(false);
  const [webDestinationResults, setWebDestinationResults] = useState<DestinationOption[]>([]);
  const [isSearchingWebDestinations, setIsSearchingWebDestinations] = useState(false);
  const [webDestinationError, setWebDestinationError] = useState<string | null>(null);
  const [isBudgetAiAvailable, setIsBudgetAiAvailable] = useState(false);
  const [isEstimatingBudget, setIsEstimatingBudget] = useState(false);
  const [budgetEstimate, setBudgetEstimate] = useState<TripBudgetEstimate | null>(null);
  const [budgetEstimateError, setBudgetEstimateError] = useState<string | null>(null);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasGeneratedName, setHasGeneratedName] = useState(Boolean(editingTrip));
  const [hasEstimatedBudget, setHasEstimatedBudget] = useState(false);

  const aiDownload = useModelDownload();
  const scrollRef = useRef<ScrollView>(null);
  const budgetEstimateKeyRef = useRef<string | null>(null);
  const nameGenerationKeyRef = useRef<string | null>(null);

  const offlineDestinationResults = useMemo(
    () => searchOfflineDestinations(form.destinationQuery, locale, form.destinations),
    [form.destinationQuery, form.destinations, locale],
  );
  const shouldShowBudgetEstimate = isBudgetAiAvailable && form.destinations.length > 0;
  const budgetEstimateKey = useMemo(
    () =>
      [
        form.destinations.join("|"),
        toDateKey(form.startDate),
        toDateKey(form.endDate),
        form.mode,
        form.companions.length,
        form.currency,
      ].join("::"),
    [form.companions.length, form.currency, form.destinations, form.endDate, form.mode, form.startDate],
  );

  useEffect(() => {
    let isMounted = true;

    async function checkBudgetAiAvailability() {
      const model = await localModelService.getReadyModel();
      if (isMounted) setIsBudgetAiAvailable(model !== null);
    }

    checkBudgetAiAvailability();
    return () => {
      isMounted = false;
    };
  }, [aiDownload.modelId, aiDownload.status]);

  const clearBudgetEstimate = useCallback(() => {
    setBudgetEstimate(null);
    setBudgetEstimateError(null);
  }, []);

  const clearNameState = useCallback(() => {
    setNameError(null);
  }, []);

  const updateForm = useCallback(<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "mode") {
      clearBudgetEstimate();
      clearNameState();
    }
  }, [clearBudgetEstimate, clearNameState]);

  const isFormCompleteForAi = useMemo(() => {
    return (
      form.destinations.length > 0 &&
      Number(form.budget) > 0 &&
      form.endDate >= form.startDate
    );
  }, [form.budget, form.destinations.length, form.endDate, form.startDate]);

  const handleDestinationQueryChange = (value: string) => {
    setWebDestinationResults([]);
    setWebDestinationError(null);
    updateForm("destinationQuery", value);
  };

  const handleSelectDestination = (destination: string) => {
    setForm((current) => {
      const normalized = normalizeSearchText(destination);
      const exists = current.destinations.some(
        (selectedDestination) => normalizeSearchText(selectedDestination) === normalized,
      );

      return {
        ...current,
        destinationQuery: "",
        destinations: exists ? current.destinations : [...current.destinations, destination],
      };
    });
    setWebDestinationResults([]);
    setWebDestinationError(null);
    clearBudgetEstimate();
  };

  const handleRemoveDestination = (destination: string) => {
    setForm((current) => ({
      ...current,
      destinations: current.destinations.filter((item) => item !== destination),
    }));
    clearBudgetEstimate();
  };

  const handleSearchWebDestinations = async () => {
    const query = form.destinationQuery.trim();
    if (query.length < 2 || isSearchingWebDestinations) return;

    setIsSearchingWebDestinations(true);
    setWebDestinationError(null);

    try {
      const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        limit: "8",
        "accept-language": locale,
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: {
          "User-Agent": "NomadSafe/1.0",
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const results = (await response.json()) as WebDestinationResult[];
      const selectedSet = new Set(form.destinations.map(normalizeSearchText));
      const options = results
        .map((result, index) => {
          const label = formatWebDestination(result).trim();
          return label
            ? {
                id: `web-${index}-${label}`,
                label,
                detail: t("trip.webResult"),
              }
            : null;
        })
        .filter((option): option is DestinationOption => {
          if (!option) return false;
          return !selectedSet.has(normalizeSearchText(option.label));
        });

      setWebDestinationResults(options);
      if (options.length === 0) {
        setWebDestinationError(t("trip.noDestinationResults"));
      }
    } catch {
      setWebDestinationError(t("trip.destinationSearchError"));
    } finally {
      setIsSearchingWebDestinations(false);
    }
  };

  const handleAddTraveler = () => {
    const name = form.travelerName.trim();
    if (!name) return;

    setForm((current) => {
      const normalized = normalizeSearchText(name);
      const exists = current.companions.some(
        (companion) => normalizeSearchText(companion) === normalized,
      );

      return {
        ...current,
        travelerName: "",
        companions: exists ? current.companions : [...current.companions, name],
      };
    });
    clearBudgetEstimate();
  };

  const handleRemoveTraveler = (traveler: string) => {
    setForm((current) => ({
      ...current,
      companions: current.companions.filter((companion) => companion !== traveler),
    }));
    clearBudgetEstimate();
  };

  const handleSelectCurrency = (currency: string) => {
    updateForm("currency", currency);
    setIsCurrencyPickerOpen(false);
    clearBudgetEstimate();
  };

  const handleEstimateBudget = useCallback(async () => {
    if (form.destinations.length === 0 || isEstimatingBudget) return;

    budgetEstimateKeyRef.current = budgetEstimateKey;
    setIsEstimatingBudget(true);
    setBudgetEstimateError(null);

    const maxRetries = 3;
    let lastError: unknown;

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const estimate = await localModelService.estimateTripBudget({
            destinations: form.destinations,
            days: countInclusiveDays(form.startDate, form.endDate),
            travelerCount: form.mode === "group" ? form.companions.length + 1 : 1,
            currency: form.currency,
          });
          setBudgetEstimate(estimate);
          setHasEstimatedBudget(true);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
      }

      console.warn("Budget estimate failed after retries:", lastError);
      setBudgetEstimate(null);
      setBudgetEstimateError(t("trip.aiBudgetError"));
    } finally {
      await localModelService.release();
      setIsEstimatingBudget(false);
    }
  }, [
    budgetEstimateKey,
    form.companions.length,
    form.currency,
    form.destinations,
    form.endDate,
    form.mode,
    form.startDate,
    isEstimatingBudget,
    t,
  ]);

  const handleUseBudgetEstimate = () => {
    if (!budgetEstimate) return;
    updateForm("budget", `${budgetEstimate.total}`);
  };

  useEffect(() => {
    if (!shouldShowBudgetEstimate || isEstimatingBudget || hasEstimatedBudget) return;
    if (budgetEstimateKeyRef.current === budgetEstimateKey) return;

    handleEstimateBudget();
  }, [budgetEstimateKey, handleEstimateBudget, isEstimatingBudget, shouldShowBudgetEstimate, hasEstimatedBudget]);

  useEffect(() => {
    if (!shouldShowBudgetEstimate) return;

    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 120);

    return () => clearTimeout(id);
  }, [shouldShowBudgetEstimate, budgetEstimateKey]);

  const nameGenerationKey = useMemo(
    () =>
      [
        form.destinations.join("|"),
        toDateKey(form.startDate),
        toDateKey(form.endDate),
        form.mode,
        form.companions.length,
      ].join("::"),
    [form.companions.length, form.destinations, form.endDate, form.mode, form.startDate],
  );

  const handleGenerateName = useCallback(async () => {
    if (form.destinations.length === 0 || isGeneratingName) return;

    nameGenerationKeyRef.current = nameGenerationKey;
    setIsGeneratingName(true);
    setNameError(null);

    const maxRetries = 3;
    let lastError: unknown;

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const suggestion = await localModelService.suggestTripName({
            destinations: form.destinations,
            days: countInclusiveDays(form.startDate, form.endDate),
            mode: form.mode,
            travelerCount: form.mode === "group" ? form.companions.length + 1 : 1,
          });
          updateForm("name", suggestion.name);
          setHasGeneratedName(true);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
      }

      console.warn("Trip name generation failed after retries:", lastError);
      setNameError(t("trip.aiNameError"));
    } finally {
      await localModelService.release();
      setIsGeneratingName(false);
    }
  }, [
    form.companions.length,
    form.destinations,
    form.endDate,
    form.mode,
    form.startDate,
    isGeneratingName,
    nameGenerationKey,
    t,
    updateForm,
  ]);

  useEffect(() => {
    if (!isBudgetAiAvailable || isGeneratingName || hasGeneratedName) return;
    if (!isFormCompleteForAi) return;
    if (nameGenerationKeyRef.current === nameGenerationKey) return;

    handleGenerateName();
  }, [isBudgetAiAvailable, isFormCompleteForAi, isGeneratingName, nameGenerationKey, handleGenerateName, hasGeneratedName]);

  const handleDateChange = (field: DateField, date: Date) => {
    const selectedDate = startOfLocalDay(date);

    setForm((current) => {
      if (field === "start") {
        return {
          ...current,
          startDate: selectedDate,
          endDate: current.endDate < selectedDate ? selectedDate : current.endDate,
        };
      }

      return { ...current, endDate: selectedDate };
    });
    clearBudgetEstimate();
  };

  const handleSave = async () => {
    const trimmedName = form.name.trim();
    const budget = Number(form.budget);

    if (!trimmedName || form.destinations.length === 0 || !Number.isFinite(budget) || budget <= 0) {
      Alert.alert(t("trip.validationTitle"), t("trip.validationBody"));
      return;
    }

    if (form.endDate < form.startDate) {
      Alert.alert(t("trip.dateValidationTitle"), t("trip.dateValidationBody"));
      return;
    }

    const destinationCoordinates = await geocodeDestinations(form.destinations);

    if (editingTrip) {
      const updateInput: UpdateTripInput = {
        name: trimmedName,
        destinations: form.destinations,
        destinationCoordinates,
        startDate: toDateKey(form.startDate),
        endDate: toDateKey(form.endDate),
        mode: form.mode,
        budget,
        currency: form.currency,
        companions: form.mode === "group" ? form.companions : [],
      };
      updateTrip(editingTrip.id, updateInput);
    } else {
      const createInput: CreateTripInput = {
        name: trimmedName,
        destinations: form.destinations,
        destinationCoordinates,
        startDate: toDateKey(form.startDate),
        endDate: toDateKey(form.endDate),
        mode: form.mode,
        budget,
        currency: form.currency,
        companions: form.mode === "group" ? form.companions : [],
      };
      createTrip(createInput);
    }

    onSave();
  };

  const budgetCurrencyAffix = getCurrencyAffix(locale, form.currency);

  return (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.stack}>
        <View style={styles.heroHeader}>
          <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>
            {editingTrip ? t("trip.editEyebrow") : t("trip.createEyebrow")}
          </Text>
          <Text style={[styles.heroTitle, { color: theme.inkDeep }]}>
            {editingTrip ? t("trip.editTitle") : t("trip.createTitle")}
          </Text>
          <Text style={[styles.heroBody, { color: theme.inkSoft }]}>
            {editingTrip ? t("trip.editBody") : t("trip.createBody")}
          </Text>
        </View>

        <View
          style={[
            styles.formCard,
            { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
          ]}
        >
          <DestinationSelector
            label={t("trip.destination")}
            value={form.destinationQuery}
            placeholder={t("trip.destinationPlaceholder")}
            selectedDestinations={form.destinations}
            offlineOptions={offlineDestinationResults}
            webOptions={webDestinationResults}
            isSearchingWeb={isSearchingWebDestinations}
            webError={webDestinationError}
            onChangeText={handleDestinationQueryChange}
            onSelect={handleSelectDestination}
            onRemove={handleRemoveDestination}
            onSearchWeb={handleSearchWebDestinations}
          />

          <View style={styles.dateSection}>
            <Text style={[styles.dateSectionLabel, { color: theme.inkMuted }]}>
              {t("trip.travelDates")}
            </Text>
            <View style={styles.dateRouteRow}>
              <DateButton
                label={t("trip.departDate")}
                primary={formatDatePart(form.startDate, locale, {
                  month: "short",
                  day: "numeric",
                })}
                secondary={formatDatePart(form.startDate, locale, {
                  weekday: "short",
                  year: "numeric",
                })}
                date={form.startDate}
                isActive={pickerField === "start"}
                isDark={isDark}
                minimumDate={undefined}
                onPress={() => setPickerField("start")}
                onDateChange={(date) => handleDateChange("start", date)}
                onDismiss={() => setPickerField(null)}
              />
              <View style={styles.dateConnector}>
                <View style={[styles.dateConnectorLine, { backgroundColor: theme.hairline }]} />
                <View style={[styles.dateConnectorDot, { backgroundColor: theme.teal }]} />
                <View style={[styles.dateConnectorLine, { backgroundColor: theme.hairline }]} />
              </View>
              <DateButton
                label={t("trip.returnDate")}
                primary={formatDatePart(form.endDate, locale, {
                  month: "short",
                  day: "numeric",
                })}
                secondary={formatDatePart(form.endDate, locale, {
                  weekday: "short",
                  year: "numeric",
                })}
                date={form.endDate}
                isActive={pickerField === "end"}
                isDark={isDark}
                minimumDate={form.startDate}
                onPress={() => setPickerField("end")}
                onDateChange={(date) => handleDateChange("end", date)}
                onDismiss={() => setPickerField(null)}
              />
            </View>
          </View>

          <TripTextInput
            label={t("trip.budget")}
            labelMeta={form.currency}
            onLabelMetaPress={() => setIsCurrencyPickerOpen((open) => !open)}
            prefix={budgetCurrencyAffix.prefix}
            suffix={budgetCurrencyAffix.suffix}
            value={form.budget}
            placeholder={t("trip.budgetPlaceholder")}
            keyboardType="numeric"
            onChangeText={(value) => updateForm("budget", value.replace(/[^0-9.]/g, ""))}
          />
          {isCurrencyPickerOpen ? (
            <View style={styles.currencyGrid}>
              {CURRENCY_OPTIONS.map((option) => {
                const isActive = option.code === form.currency;
                return (
                  <Pressable
                    key={option.code}
                    onPress={() => handleSelectCurrency(option.code)}
                    style={[
                      styles.currencyOption,
                      {
                        backgroundColor: isActive ? theme.tealSoft : theme.paper,
                        borderColor: isActive ? theme.teal : theme.hairline,
                      },
                    ]}
                  >
                    <Text style={[styles.currencyCode, { color: theme.inkDeep }]}>
                      {option.code}
                    </Text>
                    <Text style={[styles.currencyName, { color: theme.inkSoft }]}>
                      {option.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <NameInput
            value={form.name}
            generated={hasGeneratedName}
            isGenerating={isGeneratingName}
            error={nameError}
            canGenerate={isBudgetAiAvailable && form.destinations.length > 0}
            onChangeText={(value) => updateForm("name", value)}
            onGenerate={handleGenerateName}
          />

          {shouldShowBudgetEstimate ? (
            <BudgetEstimateCard
              estimate={budgetEstimate}
              error={budgetEstimateError}
              isLoading={isEstimatingBudget}
              canEstimate={form.destinations.length > 0}
              formattedTotal={
                budgetEstimate
                  ? formatCurrency(budgetEstimate.total, form.currency, {
                      maximumFractionDigits: 0,
                    })
                  : null
              }
              formattedDaily={
                budgetEstimate
                  ? formatCurrency(budgetEstimate.daily, form.currency, {
                      maximumFractionDigits: 0,
                    })
                  : null
              }
              onEstimate={handleEstimateBudget}
              onUseEstimate={handleUseBudgetEstimate}
            />
          ) : null}

          <View style={styles.segmentWrap}>
            <ModeButton
              active={form.mode === "solo"}
              icon="compass"
              title={t("trip.solo")}
              subtitle={t("trip.soloSub")}
              onPress={() => updateForm("mode", "solo")}
            />
            <ModeButton
              active={form.mode === "group"}
              icon="users"
              title={t("trip.group")}
              subtitle={t("trip.groupSub")}
              onPress={() => updateForm("mode", "group")}
            />
          </View>

          {form.mode === "group" ? (
            <TravelerSelector
              label={t("trip.travelers")}
              value={form.travelerName}
              travelers={form.companions}
              placeholder={t("trip.travelersPlaceholder")}
              onChangeText={(value) => updateForm("travelerName", value)}
              onAdd={handleAddTraveler}
              onRemove={handleRemoveTraveler}
            />
          ) : null}
        </View>

        <View style={styles.actions}>
          {onCancel ? (
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  backgroundColor: theme.paperSoft,
                  borderColor: theme.hairline,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.inkDeep }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [
              styles.createButton,
              {
                backgroundColor: theme.teal,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Icon name="flag" size={18} color={theme.inverse} />
            <Text style={[styles.createButtonText, { color: theme.inverse }]}>
              {editingTrip ? t("trip.saveAction") : t("trip.createAction")}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.encryptedNote, { color: theme.inkMuted }]}>
          {t("trip.encryptedNote")}
        </Text>
      </View>
    </ScrollView>
  );
}

function TripTextInput({
  label,
  labelMeta,
  prefix,
  suffix,
  value,
  placeholder,
  keyboardType,
  onLabelMetaPress,
  onChangeText,
}: {
  label: string;
  labelMeta?: string;
  prefix?: string;
  suffix?: string;
  value: string;
  placeholder: string;
  keyboardType?: "default" | "numeric";
  onLabelMetaPress?: () => void;
  onChangeText: (value: string) => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;

  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputHeader}>
        <Text style={[styles.inputLabel, { color: theme.inkMuted }]}>{label}</Text>
        {labelMeta ? (
          <Pressable onPress={onLabelMetaPress} disabled={!onLabelMetaPress} hitSlop={8}>
            <Text style={[styles.inputMeta, { color: theme.teal }]}>{labelMeta}</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: theme.paper,
            borderColor: theme.hairline,
          },
        ]}
      >
        {prefix ? (
          <Text style={[styles.inputPrefix, { color: theme.inkDeep }]}>{prefix}</Text>
        ) : null}
        <TextInput
          value={value}
          placeholder={placeholder}
          placeholderTextColor={theme.inkMuted}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          style={[styles.input, { color: theme.inkDeep }]}
        />
        {suffix ? (
          <Text style={[styles.inputPrefix, { color: theme.inkDeep }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

function BudgetEstimateCard({
  estimate,
  error,
  isLoading,
  canEstimate,
  formattedTotal,
  formattedDaily,
  onEstimate,
  onUseEstimate,
}: {
  estimate: TripBudgetEstimate | null;
  error: string | null;
  isLoading: boolean;
  canEstimate: boolean;
  formattedTotal: string | null;
  formattedDaily: string | null;
  onEstimate: () => void;
  onUseEstimate: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();

  return (
    <Animated.View
      entering={FadeInDown.duration(260)}
      layout={LinearTransition.duration(220)}
      style={[styles.aiBudgetCard, { backgroundColor: theme.paper, borderColor: theme.hairline }]}
    >
      <View style={styles.aiBudgetHeader}>
        <View style={[styles.aiBudgetIcon, { backgroundColor: theme.mustardSoft }]}>
          {isLoading ? (
            <ActivityIndicator size="small" color={theme.mustard} />
          ) : (
            <Icon name="sparkle" size={16} color={theme.mustard} />
          )}
        </View>
        <View style={styles.aiBudgetCopy}>
          <Text style={[styles.aiBudgetTitle, { color: theme.inkDeep }]}>
            {t("trip.aiBudgetTitle")}
          </Text>
          <Text style={[styles.aiBudgetSub, { color: theme.inkSoft }]}>
            {estimate && formattedTotal && formattedDaily
              ? t("trip.aiBudgetEstimate", {
                  total: formattedTotal,
                  daily: formattedDaily,
                })
              : error ?? t("trip.aiBudgetBody")}
          </Text>
        </View>
      </View>

      {estimate ? (
        <Text style={[styles.aiBudgetReason, { color: theme.inkSoft }]}>
          {estimate.rationale}
        </Text>
      ) : null}

      <View style={styles.aiBudgetActions}>
        <Pressable
          onPress={onEstimate}
          disabled={!canEstimate || isLoading}
          style={[
            styles.aiBudgetButton,
            {
              backgroundColor: theme.tealSoft,
              opacity: canEstimate && !isLoading ? 1 : 0.45,
            },
          ]}
        >
          <Text style={[styles.aiBudgetButtonText, { color: theme.teal }]}>
            {isLoading ? t("trip.aiBudgetEstimating") : t("trip.aiBudgetAction")}
          </Text>
        </Pressable>
        {estimate ? (
          <Pressable
            onPress={onUseEstimate}
            style={[styles.aiBudgetButton, { backgroundColor: theme.teal }]}
          >
            <Text style={[styles.aiBudgetButtonText, { color: theme.inverse }]}>
              {t("trip.aiBudgetUse")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

function DestinationSelector({
  label,
  value,
  placeholder,
  selectedDestinations,
  offlineOptions,
  webOptions,
  isSearchingWeb,
  webError,
  onChangeText,
  onSelect,
  onRemove,
  onSearchWeb,
}: {
  label: string;
  value: string;
  placeholder: string;
  selectedDestinations: string[];
  offlineOptions: DestinationOption[];
  webOptions: DestinationOption[];
  isSearchingWeb: boolean;
  webError: string | null;
  onChangeText: (value: string) => void;
  onSelect: (destination: string) => void;
  onRemove: (destination: string) => void;
  onSearchWeb: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const showLookup = value.trim().length >= 2 && offlineOptions.length === 0 && webOptions.length === 0;
  const showDropdown = value.trim().length >= 2 || webOptions.length > 0 || Boolean(webError);

  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.inputLabel, { color: theme.inkMuted }]}>{label}</Text>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: theme.paper,
            borderColor: theme.hairline,
          },
        ]}
      >
        <TextInput
          value={value}
          placeholder={placeholder}
          placeholderTextColor={theme.inkMuted}
          onChangeText={onChangeText}
          autoCapitalize="words"
          style={[styles.input, { color: theme.inkDeep }]}
        />
      </View>

      {selectedDestinations.length > 0 ? (
        <View style={styles.chipRow}>
          {selectedDestinations.map((destination) => (
            <RemovableChip
              key={destination}
              label={destination}
              onRemove={() => onRemove(destination)}
            />
          ))}
        </View>
      ) : null}

      {showDropdown ? (
        <View style={[styles.dropdown, { backgroundColor: theme.paper, borderColor: theme.hairline }]}>
          {offlineOptions.map((option) => (
            <DestinationOptionRow
              key={option.id}
              option={option}
              onPress={() => onSelect(option.label)}
            />
          ))}

          {showLookup ? (
            <Pressable
              onPress={onSearchWeb}
              disabled={isSearchingWeb}
              style={({ pressed }) => [
                styles.optionRow,
                { opacity: pressed || isSearchingWeb ? 0.65 : 1 },
              ]}
            >
              <View style={[styles.optionIcon, { backgroundColor: theme.tealSoft }]}>
                {isSearchingWeb ? (
                  <ActivityIndicator size="small" color={theme.teal} />
                ) : (
                  <Icon name="compass" size={16} color={theme.teal} />
                )}
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionLabel, { color: theme.inkDeep }]}>
                  {t("trip.searchWebForDestination", { query: value.trim() })}
                </Text>
                <Text style={[styles.optionDetail, { color: theme.inkSoft }]}>
                  {t("trip.offlineDestinationEmpty")}
                </Text>
              </View>
            </Pressable>
          ) : null}

          {webOptions.map((option) => (
            <DestinationOptionRow
              key={option.id}
              option={option}
              onPress={() => onSelect(option.label)}
            />
          ))}

          {webError ? (
            <Text style={[styles.dropdownMessage, { color: theme.inkSoft }]}>
              {webError}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DestinationOptionRow({
  option,
  onPress,
}: {
  option: DestinationOption;
  onPress: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, { opacity: pressed ? 0.65 : 1 }]}
    >
      <View style={[styles.optionIcon, { backgroundColor: theme.tealSoft }]}>
        <Icon name="mapPin" size={16} color={theme.teal} />
      </View>
      <View style={styles.optionCopy}>
        <Text style={[styles.optionLabel, { color: theme.inkDeep }]}>{option.label}</Text>
        <Text style={[styles.optionDetail, { color: theme.inkSoft }]}>{option.detail}</Text>
      </View>
    </Pressable>
  );
}

function TravelerSelector({
  label,
  value,
  travelers,
  placeholder,
  onChangeText,
  onAdd,
  onRemove,
}: {
  label: string;
  value: string;
  travelers: string[];
  placeholder: string;
  onChangeText: (value: string) => void;
  onAdd: () => void;
  onRemove: (traveler: string) => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const canAdd = value.trim().length > 0;

  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.inputLabel, { color: theme.inkMuted }]}>{label}</Text>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: theme.paper,
            borderColor: theme.hairline,
          },
        ]}
      >
        <TextInput
          value={value}
          placeholder={placeholder}
          placeholderTextColor={theme.inkMuted}
          onChangeText={onChangeText}
          onSubmitEditing={onAdd}
          autoCapitalize="words"
          style={[styles.input, { color: theme.inkDeep }]}
        />
        <Pressable
          onPress={onAdd}
          disabled={!canAdd}
          style={[styles.addButton, { backgroundColor: theme.tealSoft, opacity: canAdd ? 1 : 0.45 }]}
        >
          <Icon name="plus" size={16} color={theme.teal} />
        </Pressable>
      </View>

      {travelers.length > 0 ? (
        <View style={styles.chipRow}>
          {travelers.map((traveler) => (
            <RemovableChip
              key={traveler}
              label={traveler}
              onRemove={() => onRemove(traveler)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RemovableChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;

  return (
    <View style={[styles.chip, { backgroundColor: theme.tealSoft, borderColor: theme.hairline }]}>
      <Text style={[styles.chipText, { color: theme.inkDeep }]}>{label}</Text>
      <Pressable onPress={onRemove} hitSlop={8}>
        <Icon name="x" size={14} color={theme.inkSoft} />
      </Pressable>
    </View>
  );
}

function NameInput({
  value,
  generated,
  isGenerating,
  error,
  canGenerate,
  onChangeText,
  onGenerate,
}: {
  value: string;
  generated: boolean;
  isGenerating: boolean;
  error: string | null;
  canGenerate: boolean;
  onChangeText: (value: string) => void;
  onGenerate: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();

  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputHeader}>
        <Text style={[styles.inputLabel, { color: theme.inkMuted }]}>{t("trip.tripName")}</Text>
        <Pressable onPress={onGenerate} disabled={!canGenerate || isGenerating} hitSlop={8}>
          <Text
            style={[
              styles.inputMeta,
              { color: canGenerate && !isGenerating ? theme.teal : theme.inkMuted },
            ]}
          >
            {isGenerating ? t("trip.aiNameGenerating") : generated ? t("trip.aiNameRegenerate") : t("trip.aiNameGenerate")}
          </Text>
        </Pressable>
      </View>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: theme.paper,
            borderColor: theme.hairline,
          },
        ]}
      >
        <TextInput
          value={value}
          placeholder={t("trip.tripNamePlaceholder")}
          placeholderTextColor={theme.inkMuted}
          onChangeText={onChangeText}
          style={[styles.input, { color: theme.inkDeep }]}
        />
      </View>
      {error ? (
        <Text style={[styles.nameError, { color: theme.inkSoft }]}>{error}</Text>
      ) : null}
    </View>
  );
}

function DateButton({
  label,
  primary,
  secondary,
  date,
  isActive,
  isDark,
  minimumDate,
  onPress,
  onDateChange,
  onDismiss,
}: {
  label: string;
  primary: string;
  secondary: string;
  date: Date;
  isActive: boolean;
  isDark: boolean;
  minimumDate?: Date;
  onPress: () => void;
  onDateChange: (date: Date) => void;
  onDismiss: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const isIOS = process.env.EXPO_OS === "ios";
  const isAndroid = process.env.EXPO_OS === "android";

  if (isIOS) {
    return (
      <>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [
            styles.dateButton,
            {
              backgroundColor: theme.paper,
              borderColor: isActive ? theme.teal : theme.hairline,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Text style={[styles.dateLabel, { color: theme.inkMuted }]}>{label}</Text>
          <Text style={[styles.dateValue, { color: theme.inkDeep }]}>{primary}</Text>
          <Text style={[styles.dateSubValue, { color: theme.inkSoft }]}>{secondary}</Text>
        </Pressable>

        <Modal
          visible={isActive}
          transparent
          animationType="slide"
          onRequestClose={onDismiss}
        >
          <Pressable style={styles.dateSheetBackdrop} onPress={onDismiss} />
          <View
            style={[
              styles.dateSheet,
              {
                backgroundColor: theme.paperSoft,
                borderColor: theme.hairline,
              },
            ]}
          >
            <View style={[styles.dateSheetGrabber, { backgroundColor: theme.hairline }]} />
            <View style={styles.dateSheetHeader}>
              <View>
                <Text style={[styles.dateSheetLabel, { color: theme.inkMuted }]}>
                  {label}
                </Text>
                <Text style={[styles.dateSheetTitle, { color: theme.inkDeep }]}>
                  {primary}
                </Text>
              </View>
              <Pressable
                onPress={onDismiss}
                style={[styles.dateDoneButton, { backgroundColor: theme.tealSoft }]}
              >
                <Text style={[styles.dateDoneText, { color: theme.teal }]}>
                  {t("common.ok")}
                </Text>
              </Pressable>
            </View>
            <Host
              matchContents={{ vertical: true }}
              colorScheme={isDark ? "dark" : "light"}
              ignoreSafeArea="all"
              style={styles.dateSheetHost}
            >
              <SwiftDatePicker
                selection={date}
                range={minimumDate ? { start: minimumDate } : undefined}
                displayedComponents={["date"]}
                onDateChange={onDateChange}
                modifiers={[
                  datePickerStyle("graphical"),
                  tint(theme.teal),
                  environment("colorScheme", isDark ? "dark" : "light"),
                ]}
              />
            </Host>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dateButton,
        {
          backgroundColor: theme.paper,
          borderColor: isActive ? theme.teal : theme.hairline,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[styles.dateLabel, { color: theme.inkMuted }]}>{label}</Text>
      <Text style={[styles.dateValue, { color: theme.inkDeep }]}>{primary}</Text>
      <Text style={[styles.dateSubValue, { color: theme.inkSoft }]}>{secondary}</Text>
      {isAndroid && isActive ? (
        <DateTimePicker
          value={date}
          mode="date"
          minimumDate={minimumDate}
          display="default"
          presentation="dialog"
          accentColor={theme.teal}
          positiveButton={{ label: t("common.ok") }}
          negativeButton={{ label: t("common.cancel") }}
          onDismiss={onDismiss}
          onValueChange={(_, selectedDate) => {
            onDateChange(selectedDate);
            onDismiss();
          }}
        />
      ) : null}
    </Pressable>
  );
}

function ModeButton({
  active,
  icon,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  icon: "compass" | "users";
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.modeButton,
        {
          backgroundColor: active ? theme.tealSoft : theme.paper,
          borderColor: active ? theme.teal : theme.hairline,
        },
      ]}
    >
      <View
        style={[
          styles.modeIcon,
          { backgroundColor: active ? theme.teal : theme.tealSoft },
        ]}
      >
        <Icon name={icon} size={18} color={active ? theme.inverse : theme.teal} />
      </View>
      <View style={styles.modeCopy}>
        <Text style={[styles.modeTitle, { color: theme.inkDeep }]}>{title}</Text>
        <Text style={[styles.modeSub, { color: theme.inkSoft }]}>{subtitle}</Text>
      </View>
      <View
        style={[
          styles.modeCheck,
          {
            backgroundColor: active ? theme.teal : "transparent",
            borderColor: active ? theme.teal : theme.hairline,
          },
        ]}
      >
        {active ? <Icon name="check" size={12} color={theme.inverse} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 120,
  },
  stack: {
    gap: 16,
  },
  heroHeader: {
    paddingHorizontal: 6,
    paddingTop: 8,
    gap: 7,
  },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 38,
    lineHeight: 40,
    letterSpacing: 0,
  },
  heroBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 14,
    lineHeight: 21,
  },
  formCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  inputGroup: {
    gap: 7,
  },
  inputHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  inputLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  inputMeta: {
    fontFamily: NOMAD_FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  inputShell: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputPrefix: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
  },
  input: {
    flex: 1,
    minHeight: 50,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 15,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 34,
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  chipText: {
    flexShrink: 1,
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 12.5,
    lineHeight: 17,
  },
  dropdown: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  optionRow: {
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionCopy: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
    lineHeight: 19,
  },
  optionDetail: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 16,
  },
  dropdownMessage: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12.5,
    lineHeight: 17,
  },
  currencyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  currencyOption: {
    width: "48.5%",
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  currencyCode: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
  currencyName: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    marginTop: 2,
  },
  dateSection: {
    gap: 7,
  },
  dateSectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  dateRouteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dateButton: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  dateLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  dateValue: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
    marginTop: 2,
  },
  dateSubValue: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
  },
  dateConnector: {
    width: 24,
    alignItems: "center",
    gap: 4,
  },
  dateConnectorLine: {
    width: 1,
    flex: 1,
    minHeight: 8,
  },
  dateConnectorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dateSheetBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  dateSheet: {
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
  dateSheetGrabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  dateSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  dateSheetLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  dateSheetTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 22,
    marginTop: 4,
  },
  dateDoneButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dateDoneText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
  dateSheetHost: {
    minHeight: 360,
  },
  segmentWrap: {
    flexDirection: "row",
    gap: 10,
  },
  modeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
  },
  modeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  modeCopy: {
    flex: 1,
    gap: 1,
  },
  modeTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
  modeSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
  },
  modeCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  aiBudgetCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  aiBudgetHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  aiBudgetIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  aiBudgetCopy: {
    flex: 1,
    gap: 2,
  },
  aiBudgetTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
  aiBudgetSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  aiBudgetReason: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  aiBudgetActions: {
    flexDirection: "row",
    gap: 10,
  },
  aiBudgetButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  aiBudgetButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    gap: 10,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    paddingVertical: 16,
  },
  createButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
  nameError: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12.5,
    lineHeight: 17,
  },
  encryptedNote: {
    textAlign: "center",
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11,
    lineHeight: 16,
  },
});
