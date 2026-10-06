import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import {
  AuraButton,
  AuraChip,
  AuraDateField,
  AuraField,
  AuraSheet,
  Icon,
  type IconName,
  PressableScale,
  showAlert,
  useAura,
} from "@/atoms";
import { aiRuntime, aiService, useAiAvailability, type TripBudgetEstimate } from "@/modules/ai";
import { normalizeSearchText } from "@/features/trips/data/destinations";
import {
  type CreateTripInput,
  getDestinationCoordinates,
  type LatLng,
  type Trip,
  type TripMode,
  type UpdateTripInput,
  useTripsStore,
} from "@/features/trips/store/tripsStore";
import { geocodeDestinations } from "@/features/trips/services/geocoding";
import { DestinationSearch } from "@/features/trips/components/DestinationSearch";
import { addDays, countInclusiveDays, fromDateKey, startOfLocalDay, toDateKey } from "@/features/trips/utils/dates";
import { parseAmount, sanitizeAmountInput } from "@/features/trips/utils/amount";
import { defaultTripName } from "@/features/trips/utils/tripName";
import { useDefaultCurrency, useLocalization } from "@/localization";
import { currencyCodes } from "@/utils/currency";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { showInterstitial } from "@/modules/ads";

type DateField = "start" | "end";
/** Who set the name: "auto" names follow the destinations; "user"/"ai" names are never overwritten by the default. */
type NameSource = "auto" | "user" | "ai";

interface FormState {
  name: string;
  nameSource: NameSource;
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

export interface TripFormProps {
  editingTrip?: Trip | null;
  onSave: () => void;
  onCancel?: () => void;
  /** Cities picked outside the form (the trip planner); hides the form's own destination search. */
  destinations?: string[];
  /** Coordinates already resolved for `destinations`, so saving doesn't geocode them again. */
  knownCoordinates?: ReadonlyMap<string, LatLng | null>;
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
    nameSource: "auto",
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

/** Inputs that change the AI budget estimate. */
function budgetEstimateKeyOf(form: FormState): string {
  return [
    form.destinations.join("|"),
    toDateKey(form.startDate),
    toDateKey(form.endDate),
    form.mode,
    form.companions.length,
    form.currency,
  ].join("::");
}

function tripToFormState(trip: Trip): FormState {
  return {
    name: trip.name,
    nameSource: "user",
    destinationQuery: "",
    destinations: trip.destinations,
    startDate: fromDateKey(trip.startDate),
    endDate: fromDateKey(trip.endDate),
    mode: trip.mode,
    budget: trip.budget > 0 ? String(trip.budget) : "",
    currency: trip.currency,
    travelerName: "",
    companions: trip.companions,
  };
}

export function TripForm({ editingTrip, onSave, onCancel, destinations, knownCoordinates }: TripFormProps) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const defaultCurrency = useDefaultCurrency();
  const createTrip = useTripsStore((state) => state.createTrip);
  const updateTrip = useTripsStore((state) => state.updateTrip);

  const initialForm = useMemo(
    () =>
      editingTrip
        ? tripToFormState(editingTrip)
        : makeInitialForm(
            defaultCurrency,
            destinations?.length ? { destinations, name: defaultTripName(destinations, t) } : undefined,
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingTrip, defaultCurrency],
  );

  const [form, setForm] = useState<FormState>(initialForm);
  const [isCurrencyPickerOpen, setIsCurrencyPickerOpen] = useState(false);
  const [isEstimatingBudget, setIsEstimatingBudget] = useState(false);
  const [budgetEstimate, setBudgetEstimate] = useState<TripBudgetEstimate | null>(null);
  const [budgetEstimateError, setBudgetEstimateError] = useState<string | null>(null);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasGeneratedName, setHasGeneratedName] = useState(Boolean(editingTrip));
  const [hasEstimatedBudget, setHasEstimatedBudget] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  // One AI task at a time: auto budget and auto name are chained through this.
  const aiTaskRef = useRef<"budget" | "name" | null>(null);
  const parsedBudget = parseAmount(form.budget, locale);

  const scrollRef = useRef<ScrollView>(null);
  const budgetEstimateKeyRef = useRef<string | null>(null);
  const nameGenerationKeyRef = useRef<string | null>(null);

  const isAiReady = useAiAvailability("tripBudget").available;
  const shouldShowBudgetEstimate = isAiReady && form.destinations.length > 0;
  const budgetEstimateKey = budgetEstimateKeyOf(form);
  // Edit opens with the saved trip's key, so it only re-estimates and scrolls after a change.
  const [openedEstimateKey] = useState(() => (editingTrip ? budgetEstimateKeyOf(initialForm) : null));

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

  const isFormCompleteForAi = form.destinations.length > 0 && form.endDate >= form.startDate;
  const suggestedName = defaultTripName(form.destinations, t);

  const withDestinations = (current: FormState, destinations: string[]): FormState => ({
    ...current,
    destinations,
    name: current.nameSource === "auto" ? defaultTripName(destinations, t) : current.name,
  });

  const destinationsKey = destinations?.join("|");
  const [syncedDestinationsKey, setSyncedDestinationsKey] = useState(destinationsKey);
  if (destinations && destinationsKey !== syncedDestinationsKey) {
    setSyncedDestinationsKey(destinationsKey);
    setForm((current) => withDestinations(current, destinations));
    clearBudgetEstimate();
  }

  const handleSelectDestination = (destination: string) => {
    setForm((current) => {
      const normalized = normalizeSearchText(destination);
      const exists = current.destinations.some(
        (selectedDestination) => normalizeSearchText(selectedDestination) === normalized,
      );

      return {
        ...withDestinations(
          current,
          exists ? current.destinations : [...current.destinations, destination],
        ),
        destinationQuery: "",
      };
    });
    clearBudgetEstimate();
  };

  const handleRemoveDestination = (destination: string) => {
    setForm((current) =>
      withDestinations(
        current,
        current.destinations.filter((item) => item !== destination),
      ),
    );
    clearBudgetEstimate();
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

  const sharedMemberNames = new Set(editingTrip?.shared?.members.map((member) => member.name) ?? []);

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
    if (form.destinations.length === 0 || aiTaskRef.current) return;

    aiTaskRef.current = "budget";
    budgetEstimateKeyRef.current = budgetEstimateKey;
    setIsEstimatingBudget(true);
    setBudgetEstimateError(null);

    const maxRetries = 3;
    let lastError: unknown;

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const estimate = await aiService.estimateTripBudget({
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

      logger.warn("trip-form", "budget estimate failed after retries", lastError);
      setBudgetEstimate(null);
      setBudgetEstimateError(t("trip.aiBudgetError"));
    } finally {
      await aiRuntime.release();
      aiTaskRef.current = null;
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
    t,
  ]);

  const handleUseBudgetEstimate = () => {
    if (!budgetEstimate) return;
    updateForm("budget", `${budgetEstimate.total}`);
  };

  const isAiBusy = isEstimatingBudget || isGeneratingName;

  useEffect(() => {
    if (!shouldShowBudgetEstimate || isAiBusy || hasEstimatedBudget) return;
    if (budgetEstimateKeyRef.current === budgetEstimateKey || openedEstimateKey === budgetEstimateKey) return;

    handleEstimateBudget();
  }, [budgetEstimateKey, handleEstimateBudget, isAiBusy, shouldShowBudgetEstimate, hasEstimatedBudget, openedEstimateKey]);

  useEffect(() => {
    if (!shouldShowBudgetEstimate || openedEstimateKey === budgetEstimateKey) return;

    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 120);

    return () => clearTimeout(id);
  }, [shouldShowBudgetEstimate, budgetEstimateKey, openedEstimateKey]);

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

  /** `auto` runs never replace a name the user typed, even one typed mid-generation. */
  const handleGenerateName = useCallback(async (auto = false) => {
    if (form.destinations.length === 0 || aiTaskRef.current) return;

    aiTaskRef.current = "name";
    nameGenerationKeyRef.current = nameGenerationKey;
    setIsGeneratingName(true);
    setNameError(null);

    const maxRetries = 3;
    let lastError: unknown;

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const suggestion = await aiService.suggestTripName({
            destinations: form.destinations,
            days: countInclusiveDays(form.startDate, form.endDate),
            mode: form.mode,
            travelerCount: form.mode === "group" ? form.companions.length + 1 : 1,
          });
          setForm((current) =>
            auto && current.nameSource === "user" && current.name.trim()
              ? current
              : { ...current, name: suggestion.name, nameSource: "ai" },
          );
          setHasGeneratedName(true);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
      }

      logger.warn("trip-form", "trip name generation failed after retries", lastError);
      setNameError(t("trip.aiNameError"));
    } finally {
      await aiRuntime.release();
      aiTaskRef.current = null;
      setIsGeneratingName(false);
    }
  }, [
    form.companions.length,
    form.destinations,
    form.endDate,
    form.mode,
    form.startDate,
    nameGenerationKey,
    t,
  ]);

  const hasTypedName = form.nameSource === "user" && form.name.trim().length > 0;

  // Runs after the budget estimate settles (isAiBusy gate), never alongside it.
  useEffect(() => {
    if (!isAiReady || isAiBusy || hasGeneratedName || hasTypedName) return;
    if (!isFormCompleteForAi) return;
    if (shouldShowBudgetEstimate && !hasEstimatedBudget && budgetEstimateKeyRef.current !== budgetEstimateKey) return;
    if (nameGenerationKeyRef.current === nameGenerationKey) return;

    handleGenerateName(true);
  }, [
    budgetEstimateKey,
    handleGenerateName,
    hasEstimatedBudget,
    hasGeneratedName,
    hasTypedName,
    isAiBusy,
    isAiReady,
    isFormCompleteForAi,
    nameGenerationKey,
    shouldShowBudgetEstimate,
  ]);

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
    if (isSavingRef.current) return;

    const trimmedName = form.name.trim() || suggestedName;
    // Budget is optional; blank or non-positive input means "no budget" (stored as 0).
    const budget = Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : 0;

    if (form.destinations.length === 0 || !trimmedName) {
      showAlert(t("trip.validationTitle"), t("trip.validationBody"));
      return;
    }

    if (form.endDate < form.startDate) {
      showAlert(t("trip.dateValidationTitle"), t("trip.dateValidationBody"));
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      const known = new Map<string, LatLng | null>(knownCoordinates);
      if (editingTrip) {
        const previous = getDestinationCoordinates(editingTrip);
        editingTrip.destinations.forEach((destination, index) => {
          if (previous[index]) known.set(destination, previous[index]);
        });
      }
      const destinationCoordinates = await geocodeDestinations(form.destinations, known);

      const input = {
        name: trimmedName,
        destinations: form.destinations,
        destinationCoordinates,
        startDate: toDateKey(form.startDate),
        endDate: toDateKey(form.endDate),
        mode: form.mode,
        budget,
        currency: form.currency,
        companions: form.mode === "group" || editingTrip?.shared ? form.companions : [],
      };

      if (editingTrip) {
        updateTrip(editingTrip.id, input satisfies UpdateTripInput);
      } else {
        createTrip(input satisfies CreateTripInput);
        track("trip_created", {
          mode: input.mode,
          destinations: input.destinations.length,
          has_budget: budget > 0,
        });
      }

      onSave();
      if (!editingTrip) showInterstitial("trip_created");
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const budgetCurrencyAffix = getCurrencyAffix(locale, form.currency);
  const canSave = form.destinations.length > 0;

  const formattedEstimate = (amount: number) => formatCurrency(amount, form.currency, { maximumFractionDigits: 0 });
  const affixText = (text: string) => <Text style={[styles.affix, { color: c.textSoft, fontFamily: f.semibold }]}>{text}</Text>;
  const days = countInclusiveDays(form.startDate, form.endDate);

  return (
    <View style={styles.flex}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {destinations ? null : (
          <DestinationSearch
            label={t("trip.destination")}
            selected={form.destinations}
            onSelect={handleSelectDestination}
            autoFocus={!editingTrip && form.destinations.length === 0}
          />
        )}
        {!destinations && form.destinations.length > 0 ? (
          <Animated.View layout={LinearTransition.duration(200)} style={styles.wrap}>
            {form.destinations.map((destination) => (
              <AuraChip key={destination} label={destination} icon="mapPin" onRemove={() => handleRemoveDestination(destination)} />
            ))}
          </Animated.View>
        ) : null}

        <View style={styles.group}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("trip.travelDates")}</Text>
            <Text style={[styles.label, { color: c.textMuted, fontFamily: f.regular }]}>{t("trip.daysCount", { count: days })}</Text>
          </View>
          <AuraDateField value={form.startDate} onChange={(date) => handleDateChange("start", date)} caption={t("trip.departDate")} />
          <AuraDateField value={form.endDate} onChange={(date) => handleDateChange("end", date)} minimumDate={form.startDate} caption={t("trip.returnDate")} />
        </View>

        <AuraField
          label={t("trip.budget")}
          labelAction={
            <PressableScale onPress={() => setIsCurrencyPickerOpen((open) => !open)} hitSlop={8} style={[styles.currency, { backgroundColor: c.surfaceStrong }]}>
              <Text style={[styles.currencyText, { color: c.text, fontFamily: f.semibold }]}>{form.currency}</Text>
              <Icon name="chevronDown" size={12} color={c.textMuted} />
            </PressableScale>
          }
          value={form.budget}
          placeholder={t("trip.budgetPlaceholder")}
          keyboardType="decimal-pad"
          onChangeText={(value) => updateForm("budget", sanitizeAmountInput(value))}
          prefix={budgetCurrencyAffix.prefix ? affixText(budgetCurrencyAffix.prefix) : undefined}
          suffix={budgetCurrencyAffix.suffix ? affixText(budgetCurrencyAffix.suffix) : undefined}
        />
        {isCurrencyPickerOpen ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.wrap}>
            {currencyCodes(initialForm.currency, defaultCurrency).map((code) => (
              <AuraChip key={code} label={code} selected={code === form.currency} onPress={() => handleSelectCurrency(code)} />
            ))}
          </Animated.View>
        ) : null}

        {shouldShowBudgetEstimate ? (
          <Animated.View
            entering={FadeInDown.duration(260)}
            layout={LinearTransition.duration(220)}
            style={[styles.aiCard, { backgroundColor: c.surface, borderColor: c.hairline }]}
          >
            <View style={styles.aiHeader}>
              <View style={[styles.aiIcon, { backgroundColor: "#FFB54722" }]}>
                {isEstimatingBudget ? <ActivityIndicator size="small" color="#FFB547" /> : <Icon name="sparkle" size={16} color="#FFB547" />}
              </View>
              <View style={styles.flex}>
                <Text style={[styles.aiTitle, { color: c.text, fontFamily: f.semibold }]}>{t("trip.aiBudgetTitle")}</Text>
                <Text style={[styles.aiSub, { color: c.textSoft, fontFamily: f.regular }]}>
                  {budgetEstimate
                    ? t("trip.aiBudgetEstimate", { total: formattedEstimate(budgetEstimate.total), daily: formattedEstimate(budgetEstimate.daily) })
                    : (budgetEstimateError ?? t("trip.aiBudgetBody"))}
                </Text>
              </View>
            </View>
            {budgetEstimate ? <Text style={[styles.aiReason, { color: c.textSoft, fontFamily: f.regular }]}>{budgetEstimate.rationale}</Text> : null}
            <View style={styles.aiActions}>
              <AuraButton
                label={t("trip.aiBudgetAction")}
                icon="sparkle"
                variant="secondary"
                size="md"
                disabled={isEstimatingBudget || isGeneratingName || form.destinations.length === 0}
                onPress={() => void handleEstimateBudget()}
              />
              {budgetEstimate ? <AuraButton label={t("trip.aiBudgetUse")} size="md" onPress={handleUseBudgetEstimate} /> : null}
            </View>
          </Animated.View>
        ) : null}

        <AuraField
          label={t("trip.tripName")}
          labelAction={
            isAiReady && form.destinations.length > 0 ? (
              <PressableScale
                onPress={() => void handleGenerateName()}
                disabled={isGeneratingName || isEstimatingBudget}
                hitSlop={8}
                style={[styles.currency, { backgroundColor: c.surfaceStrong }]}
              >
                {isGeneratingName ? <ActivityIndicator size="small" color={c.textSoft} /> : <Icon name="sparkle" size={12} color="#FFB547" />}
                <Text style={[styles.currencyText, { color: c.text, fontFamily: f.semibold }]}>
                  {hasGeneratedName ? t("trip.aiNameRegenerate") : t("trip.aiNameGenerate")}
                </Text>
              </PressableScale>
            ) : undefined
          }
          value={form.name}
          placeholder={suggestedName || t("trip.tripNamePlaceholder")}
          error={nameError}
          onChangeText={(value) => setForm((current) => ({ ...current, name: value, nameSource: value.trim() ? "user" : "auto" }))}
        />

        {!editingTrip?.shared ? (
          <View style={styles.modes}>
            <ModeCard active={form.mode === "solo"} icon="compass" title={t("trip.solo")} subtitle={t("trip.soloSub")} onPress={() => updateForm("mode", "solo")} />
            <ModeCard active={form.mode === "group"} icon="users" title={t("trip.group")} subtitle={t("trip.groupSub")} onPress={() => updateForm("mode", "group")} />
          </View>
        ) : null}

        {form.mode === "group" ? (
          <Animated.View entering={FadeInDown.duration(220)} style={styles.group}>
            <AuraField
              label={t("trip.travelers")}
              value={form.travelerName}
              placeholder={t("trip.travelersPlaceholder")}
              onChangeText={(value) => updateForm("travelerName", value)}
              onSubmitEditing={handleAddTraveler}
              returnKeyType="done"
              suffix={
                <PressableScale onPress={handleAddTraveler} accessibilityRole="button" accessibilityLabel={t("itinerary.add")} style={[styles.addTraveler, { backgroundColor: c.inverse }]}>
                  <Icon name="plus" size={16} color={c.onInverse} strokeWidth={2.2} />
                </PressableScale>
              }
            />
            {form.companions.length > 0 ? (
              <View style={styles.wrap}>
                {form.companions.map((traveler) => (
                  <AuraChip
                    key={traveler}
                    label={traveler}
                    icon="users"
                    // People on a shared trip are removed from the trip's People sheet instead.
                    onRemove={sharedMemberNames.has(traveler) ? undefined : () => handleRemoveTraveler(traveler)}
                  />
                ))}
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("trip.encryptedNote")}</Text>
      </ScrollView>

      <View style={styles.footer}>
        {onCancel ? <AuraButton label={t("common.cancel")} variant="secondary" onPress={onCancel} style={styles.cancel} /> : null}
        <AuraButton
          label={isSaving ? (editingTrip ? t("trip.savingAction") : t("trip.creatingAction")) : editingTrip ? t("trip.saveAction") : t("trip.createAction")}
          icon="flag"
          loading={isSaving}
          disabled={!canSave}
          onPress={() => void handleSave()}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

function ModeCard({ active, icon, title, subtitle, onPress }: { active: boolean; icon: IconName; title: string; subtitle: string; onPress: () => void }) {
  const { c, f } = useAura();
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.97}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[styles.mode, { backgroundColor: active ? c.inverse : c.surface, borderColor: active ? c.inverse : c.hairline }]}
    >
      <Icon name={icon} size={18} color={active ? c.onInverse : c.textSoft} />
      <Text style={[styles.modeTitle, { color: active ? c.onInverse : c.text, fontFamily: f.semibold }]}>{title}</Text>
      <Text style={[styles.modeSub, { color: active ? c.onInverse : c.textMuted, fontFamily: f.regular, opacity: active ? 0.75 : 1 }]}>{subtitle}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, gap: 18 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  group: { gap: 10 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 13.5 },
  currency: { flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: 10, borderRadius: 14 },
  currencyText: { fontSize: 13 },
  affix: { fontSize: 17 },
  aiCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  aiHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  aiIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  aiTitle: { fontSize: 15 },
  aiSub: { fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  aiReason: { fontSize: 13, lineHeight: 19 },
  aiActions: { flexDirection: "row", gap: 8 },
  modes: { flexDirection: "row", gap: 10 },
  mode: { flex: 1, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4 },
  modeTitle: { fontSize: 15, marginTop: 6 },
  modeSub: { fontSize: 12.5 },
  addTraveler: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  note: { fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  cancel: { paddingHorizontal: 22 },
});

/** The trip form in an Aura sheet, for creating or editing a trip. */
export function TripFormSheet({
  visible,
  onClose,
  editingTrip,
}: {
  visible: boolean;
  onClose: () => void;
  editingTrip?: Trip | null;
}) {
  const { t } = useLocalization();
  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      full
      title={editingTrip ? t("trip.editTitle") : t("trip.createTitle")}
      subtitle={editingTrip ? t("trip.editBody") : t("trip.createBody")}
    >
      <TripForm editingTrip={editingTrip} onSave={onClose} />
    </AuraSheet>
  );
}
