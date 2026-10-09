import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import {
  AuraButton,
  AuraChip,
  AuraDateField,
  AuraField,
  AuraSheet,
  AuraSkeleton,
  AuraSkeletonGroup,
  Icon,
  type IconName,
  PressableScale,
  showAlert,
  useAura,
  showToast,
} from "@/atoms";
import { useAuthStore } from "@/features/auth/store/authStore";
import { shareGroup } from "@/features/sync";
import { aiRuntime, aiService, useAiAvailability } from "@/modules/ai";
import { normalizeSearchText } from "@/features/trips/data/destinations";
import { auraHitSlop, auraSignal } from "@/constants/aura";
import {
  type CreateTripInput,
  getDestinationCoordinates,
  type LatLng,
  type PlannedTrip,
  type Trip,
  type TripMode,
  type UpdateTripInput,
  useTripsStore,
} from "@/features/trips/store/tripsStore";
import { geocodeDestinations } from "@/features/trips/services/geocoding";
import { estimateTripBudget, TripBudgetError, type TripBudgetResult } from "@/features/trips/services/budgetEstimate";
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

const AI_IDLE_RELEASE_MS = 20_000;
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
  /** Plan this trip with a group's people (and, for a shared group, add its members directly). */
  fromGroupId?: string;
  /** Coordinates already resolved for `destinations`, so saving doesn't geocode them again. */
  knownCoordinates?: ReadonlyMap<string, LatLng | null>;
  /** Confirming this planned trip: starts from its name and month, and saving turns it into the trip. */
  plannedTrip?: PlannedTrip;
  /** Shows "Not sure of dates yet?" under the dates (new trips only). */
  onNotSureOfDates?: () => void;
}

/** First day of a planned trip's month, or today when there's none or it has started. */
function plannedStart(month: string | undefined): Date {
  const today = startOfLocalDay(new Date());
  if (!month) return today;
  const first = fromDateKey(`${month}-01`);
  return first > today ? first : today;
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

export function TripForm({ editingTrip, onSave, onCancel, destinations, knownCoordinates, fromGroupId, plannedTrip, onNotSureOfDates }: TripFormProps) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const defaultCurrency = useDefaultCurrency();
  const createTrip = useTripsStore((state) => state.createTrip);
  const updateTrip = useTripsStore((state) => state.updateTrip);
  const confirmPlannedTrip = useTripsStore((state) => state.confirmPlannedTrip);

  const fromGroup = useTripsStore((state) => (fromGroupId ? (state.groups.find((group) => group.id === fromGroupId) ?? null) : null));
  const [initialForm] = useState(() =>
      editingTrip
        ? tripToFormState(editingTrip)
        : makeInitialForm(fromGroup?.currency ?? defaultCurrency, {
            ...(destinations?.length ? { destinations, name: defaultTripName(destinations, t) } : {}),
            ...(plannedTrip
              ? { name: plannedTrip.name, nameSource: "user" as const, startDate: plannedStart(plannedTrip.month), endDate: addDays(plannedStart(plannedTrip.month), 6) }
              : {}),
            ...(fromGroup && fromGroup.companions.length > 0 ? { mode: "group" as const, companions: fromGroup.companions } : {}),
          }),
  );

  const [form, setForm] = useState<FormState>(initialForm);
  const [isCurrencyPickerOpen, setIsCurrencyPickerOpen] = useState(false);
  const [isEstimatingBudget, setIsEstimatingBudget] = useState(false);
  const [budgetEstimate, setBudgetEstimate] = useState<TripBudgetResult | null>(null);
  const [budgetEstimateError, setBudgetEstimateError] = useState<string | null>(null);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [hasGeneratedName, setHasGeneratedName] = useState(Boolean(editingTrip));
  const [hasEstimatedBudget, setHasEstimatedBudget] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  // One AI task at a time: the auto name runs first, then the auto budget, on one loaded model.
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

  const updateForm = useCallback(<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "mode") clearBudgetEstimate();
  }, [clearBudgetEstimate]);

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

    try {
      const estimate = await estimateTripBudget({
        destinations: form.destinations,
        days: countInclusiveDays(form.startDate, form.endDate),
        travelers: form.mode === "group" ? form.companions.length + 1 : 1,
        currency: form.currency,
      });
      setBudgetEstimate(estimate);
      setHasEstimatedBudget(true);
    } catch (error) {
      setBudgetEstimate(null);
      setBudgetEstimateError(
        error instanceof TripBudgetError && error.reason === "rate"
          ? t("trip.aiBudgetNoRate", { currency: form.currency })
          : t("trip.aiBudgetError"),
      );
    } finally {
      // Keep the model loaded briefly so the next AI step (or a retry) doesn't reload it.
      aiRuntime.releaseAfter(AI_IDLE_RELEASE_MS);
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

  useEffect(() => () => void aiRuntime.release(), []);

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

  /**
   * `auto` runs never replace a name the user typed, even one typed mid-generation. A failed or
   * unusable answer keeps the template name; only a tapped Generate says so.
   */
  const handleGenerateName = useCallback(async (auto = false) => {
    if (form.destinations.length === 0 || aiTaskRef.current) return;

    aiTaskRef.current = "name";
    nameGenerationKeyRef.current = nameGenerationKey;
    setIsGeneratingName(true);

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
    } catch (error) {
      logger.warn("trip-form", "trip name generation failed", error);
      if (!auto) showToast(t("trip.aiNameError"));
    } finally {
      aiRuntime.releaseAfter(AI_IDLE_RELEASE_MS);
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

  // The name goes first (a few tokens); the budget estimate follows on the same loaded model.
  useEffect(() => {
    if (!isAiReady || isAiBusy || hasGeneratedName || hasTypedName) return;
    if (!isFormCompleteForAi) return;
    if (nameGenerationKeyRef.current === nameGenerationKey) return;

    handleGenerateName(true);
  }, [handleGenerateName, hasGeneratedName, hasTypedName, isAiBusy, isAiReady, isFormCompleteForAi, nameGenerationKey]);

  useEffect(() => {
    if (!shouldShowBudgetEstimate || isAiBusy || hasEstimatedBudget) return;
    if (budgetEstimateKeyRef.current === budgetEstimateKey || openedEstimateKey === budgetEstimateKey) return;
    const nameFirst = !hasGeneratedName && !hasTypedName && isFormCompleteForAi && nameGenerationKeyRef.current !== nameGenerationKey;
    if (nameFirst) return;

    handleEstimateBudget();
  }, [
    budgetEstimateKey,
    handleEstimateBudget,
    hasEstimatedBudget,
    hasGeneratedName,
    hasTypedName,
    isAiBusy,
    isFormCompleteForAi,
    nameGenerationKey,
    openedEstimateKey,
    shouldShowBudgetEstimate,
  ]);

  useEffect(() => {
    if (!shouldShowBudgetEstimate || openedEstimateKey === budgetEstimateKey) return;

    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 120);

    return () => clearTimeout(id);
  }, [shouldShowBudgetEstimate, budgetEstimateKey, openedEstimateKey]);

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
      } else if (plannedTrip) {
        confirmPlannedTrip(plannedTrip.id, input satisfies CreateTripInput);
        track("planned_trip", { action: "confirmed", destinations: input.destinations.length, had_month: Boolean(plannedTrip.month) });
      } else {
        const created = createTrip(input satisfies CreateTripInput);
        if (fromGroup?.shared && input.companions.length > 0) {
          const ownerName = useAuthStore.getState().user?.name ?? "";
          shareGroup(created, ownerName.split(" ")[0] || ownerName, fromGroup.shared.groupId).catch(() => showToast(t("groupTrip.actionFailed")));
        }
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
          {onNotSureOfDates && !editingTrip && !plannedTrip ? (
            <PressableScale onPress={onNotSureOfDates} accessibilityRole="button" hitSlop={8} style={styles.notSure}>
              <Icon name="bookmark" size={14} color={c.textSoft} />
              <Text style={[styles.notSureText, { color: c.textSoft, fontFamily: f.medium }]}>{t("planned.notSure")}</Text>
              <Icon name="chevronRight" size={12} color={c.textMuted} />
            </PressableScale>
          ) : null}
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
              <View style={[styles.aiIcon, { backgroundColor: `${auraSignal.amber}22` }]}>
                <Icon name="sparkle" size={16} color={auraSignal.amber} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.aiTitle, { color: c.text, fontFamily: f.semibold }]}>
                  {budgetEstimate && !isEstimatingBudget
                    ? budgetEstimate.provider === "local"
                      ? t("trip.aiBudgetByDevice")
                      : t("trip.aiBudgetByOnline")
                    : t("trip.aiBudgetHeading")}
                </Text>
                {isEstimatingBudget ? (
                  <AuraSkeletonGroup label={t("trip.aiBudgetEstimating")} style={styles.aiSkeleton}>
                    <AuraSkeleton width="70%" height={13} radius={6.5} />
                    <AuraSkeleton width="45%" height={11} radius={5.5} />
                  </AuraSkeletonGroup>
                ) : (
                  <Text style={[styles.aiSub, { color: c.textSoft, fontFamily: f.regular }]} accessibilityLiveRegion="polite">
                    {budgetEstimate
                      ? t("trip.aiBudgetEstimate", { total: formattedEstimate(budgetEstimate.total), daily: formattedEstimate(budgetEstimate.daily) })
                      : (budgetEstimateError ?? t("trip.aiBudgetBody"))}
                  </Text>
                )}
              </View>
            </View>
            {budgetEstimate && !isEstimatingBudget ? (
              <View style={styles.aiNotes}>
                {budgetEstimate.rationale ? <Text style={[styles.aiReason, { color: c.textSoft, fontFamily: f.regular }]}>{budgetEstimate.rationale}</Text> : null}
                <Text style={[styles.aiBasis, { color: c.textMuted, fontFamily: f.regular }]}>{t("trip.aiBudgetBasis")}</Text>
              </View>
            ) : null}
            <View style={styles.aiActions}>
              <AuraButton
                label={t("trip.aiBudgetAction")}
                icon="sparkle"
                variant="secondary"
                size="md"
                disabled={isEstimatingBudget || isGeneratingName || form.destinations.length === 0}
                onPress={() => void handleEstimateBudget()}
              />
              {budgetEstimate && !isEstimatingBudget ? <AuraButton label={t("trip.aiBudgetUse")} size="md" onPress={handleUseBudgetEstimate} /> : null}
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
                {isGeneratingName ? <ActivityIndicator size="small" color={c.textSoft} /> : <Icon name="sparkle" size={12} color={auraSignal.amber} />}
                <Text style={[styles.currencyText, { color: c.text, fontFamily: f.semibold }]}>
                  {isGeneratingName ? t("trip.aiNameGenerating") : hasGeneratedName ? t("trip.aiNameRegenerate") : t("trip.aiNameGenerate")}
                </Text>
              </PressableScale>
            ) : undefined
          }
          value={form.name}
          placeholder={suggestedName || t("trip.tripNamePlaceholder")}
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
                <PressableScale onPress={handleAddTraveler} accessibilityRole="button" accessibilityLabel={t("itinerary.add")} hitSlop={auraHitSlop(34)} style={[styles.addTraveler, { backgroundColor: c.inverse }]}>
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
          label={
            isSaving
              ? editingTrip
                ? t("trip.savingAction")
                : t("trip.creatingAction")
              : editingTrip
                ? t("trip.saveAction")
                : plannedTrip
                  ? t("planned.confirm")
                  : t("trip.createAction")
          }
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
  notSure: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingVertical: 4 },
  notSureText: { fontSize: 14 },
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
  aiNotes: { gap: 4 },
  aiBasis: { fontSize: 12, lineHeight: 17 },
  aiSkeleton: { gap: 6, marginTop: 6 },
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
