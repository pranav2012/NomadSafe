import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import * as Location from "expo-location";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DatePicker as SwiftDatePicker, Host } from "@expo/ui/swift-ui";
import { datePickerStyle, environment, tint } from "@expo/ui/swift-ui/modifiers";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { localModelService, useModelDownload } from "@/features/ai";
import type { TripBudgetEstimate } from "@/features/ai/services/localModelService";
import { useSettingsStore } from "@/features/settings";
import { useAuthStore } from "@/features/auth";
import {
  type DestinationOption,
  normalizeSearchText,
  searchOfflineDestinations,
} from "@/features/trips/data/destinations";
import {
  type LatLng,
  type Trip,
  type TripMode,
  useTripsStore,
} from "@/features/trips/store/tripsStore";
import { TripWeather } from "@/features/trips/components/TripWeather";
import { TripItinerary, useItineraryAutoSync } from "@/features/itinerary";
import { NearbyPlaces } from "@/features/places/components/NearbyPlaces";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { CURRENCY_OPTIONS } from "@/utils/currency";
import { useTripExpenseSummary } from "@/features/expenses/hooks/useTripExpenseSummary";

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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function countInclusiveDays(startDate: Date, endDate: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return Math.max(1, Math.round((end - start) / msPerDay) + 1);
}

function getTripProgress(trip: Trip) {
  const today = startOfLocalDay(new Date());
  const startDate = fromDateKey(trip.startDate);
  const endDate = fromDateKey(trip.endDate);
  const totalDays = countInclusiveDays(startDate, endDate);
  const elapsedDays = countInclusiveDays(startDate, today);

  if (today < startOfLocalDay(startDate)) {
    return { status: "upcoming" as const, day: 0, totalDays, percent: 0 };
  }

  if (today > startOfLocalDay(endDate)) {
    return { status: "complete" as const, day: totalDays, totalDays, percent: 100 };
  }

  return {
    status: "active" as const,
    day: Math.min(elapsedDays, totalDays),
    totalDays,
    percent: Math.min(100, (elapsedDays / totalDays) * 100),
  };
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

function makeInitialForm(currency: string): FormState {
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

export default function HomeScreen() {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale, formatCurrency, formatDate } = useLocalization();
  const defaultCurrency = useSettingsStore((state) => state.defaultCurrency);
  const localAiEnabled = useSettingsStore((state) => state.localAiEnabled);
  const user = useAuthStore((state) => state.user);
  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const createTrip = useTripsStore((state) => state.createTrip);
  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? trips[0] ?? null;
  const aiDownload = useModelDownload();
  useItineraryAutoSync(activeTrip);
  const scrollRef = useRef<ScrollView>(null);
  const budgetEstimateKeyRef = useRef<string | null>(null);
  const nameGenerationKeyRef = useRef<string | null>(null);
  const [userLocation, setUserLocation] = useState<{
    city?: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
  } | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== Location.PermissionStatus.GRANTED) return;

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const [reverse] = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });

        if (isMounted && reverse) {
          setUserLocation({
            city: reverse.city ?? reverse.subregion ?? undefined,
            country: reverse.country ?? undefined,
            region: reverse.region ?? undefined,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
        }
      } catch {
        // Location is optional; fallback to null.
      }
    }

    fetchLocation();
    return () => {
      isMounted = false;
    };
  }, []);

  const [form, setForm] = useState<FormState>(() => makeInitialForm(defaultCurrency));
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
  const [hasGeneratedName, setHasGeneratedName] = useState(false);
  const [hasEstimatedBudget, setHasEstimatedBudget] = useState(false);

  const offlineDestinationResults = useMemo(
    () => searchOfflineDestinations(form.destinationQuery, locale, form.destinations),
    [form.destinationQuery, form.destinations, locale],
  );
  const isAiReady = localAiEnabled && isBudgetAiAvailable;
  const shouldShowBudgetEstimate = isAiReady && form.destinations.length > 0;
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
    if (!isAiReady || isGeneratingName || hasGeneratedName) return;
    if (!isFormCompleteForAi) return;
    if (nameGenerationKeyRef.current === nameGenerationKey) return;

    handleGenerateName();
  }, [isAiReady, isFormCompleteForAi, isGeneratingName, nameGenerationKey, handleGenerateName, hasGeneratedName]);

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

  const handleCreateTrip = () => {
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

    createTrip({
      name: trimmedName,
      destinations: form.destinations,
      startDate: toDateKey(form.startDate),
      endDate: toDateKey(form.endDate),
      mode: form.mode,
      budget,
      currency: form.currency,
      companions: form.mode === "group" ? form.companions : [],
    });
    setForm(makeInitialForm(defaultCurrency));
    setPickerField(null);
    setIsCurrencyPickerOpen(false);
    setBudgetEstimate(null);
    setBudgetEstimateError(null);
    setNameError(null);
    setHasGeneratedName(false);
    setHasEstimatedBudget(false);
    budgetEstimateKeyRef.current = null;
    nameGenerationKeyRef.current = null;
    localModelService.release();
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.root, { backgroundColor: theme.paper }]}
    >
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {activeTrip ? (
          <TripDashboard
            trip={activeTrip}
            user={user}
            userLocation={userLocation}
            locale={locale}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
          />
        ) : (
          <CreateTripForm
            form={form}
            pickerField={pickerField}
            currency={form.currency}
            isCurrencyPickerOpen={isCurrencyPickerOpen}
            shouldShowBudgetEstimate={shouldShowBudgetEstimate}
            isEstimatingBudget={isEstimatingBudget}
            budgetEstimate={budgetEstimate}
            budgetEstimateError={budgetEstimateError}
            destinationOptions={offlineDestinationResults}
            webDestinationOptions={webDestinationResults}
            isSearchingWebDestinations={isSearchingWebDestinations}
            webDestinationError={webDestinationError}
            onChange={updateForm}
            onDestinationQueryChange={handleDestinationQueryChange}
            onSelectDestination={handleSelectDestination}
            onRemoveDestination={handleRemoveDestination}
            onSearchWebDestinations={handleSearchWebDestinations}
            onAddTraveler={handleAddTraveler}
            onRemoveTraveler={handleRemoveTraveler}
            onToggleCurrencyPicker={() => setIsCurrencyPickerOpen((open) => !open)}
            onSelectCurrency={handleSelectCurrency}
            isGeneratingName={isGeneratingName}
            nameError={nameError}
            hasGeneratedName={hasGeneratedName}
            canGenerateName={isAiReady && form.destinations.length > 0}
            onGenerateName={handleGenerateName}
            onEstimateBudget={handleEstimateBudget}
            onUseBudgetEstimate={handleUseBudgetEstimate}
            onDateFieldPress={setPickerField}
            onDateChange={handleDateChange}
            onDismissPicker={() => setPickerField(null)}
            onCreateTrip={handleCreateTrip}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateTripForm({
  form,
  pickerField,
  currency,
  isCurrencyPickerOpen,
  shouldShowBudgetEstimate,
  isEstimatingBudget,
  budgetEstimate,
  budgetEstimateError,
  destinationOptions,
  webDestinationOptions,
  isSearchingWebDestinations,
  webDestinationError,
  onChange,
  onDestinationQueryChange,
  onSelectDestination,
  onRemoveDestination,
  onSearchWebDestinations,
  onAddTraveler,
  onRemoveTraveler,
  onToggleCurrencyPicker,
  onSelectCurrency,
  isGeneratingName,
  nameError,
  hasGeneratedName,
  canGenerateName,
  onGenerateName,
  onEstimateBudget,
  onUseBudgetEstimate,
  onDateFieldPress,
  onDateChange,
  onDismissPicker,
  onCreateTrip,
}: {
  form: FormState;
  pickerField: DateField | null;
  currency: string;
  isCurrencyPickerOpen: boolean;
  shouldShowBudgetEstimate: boolean;
  isEstimatingBudget: boolean;
  budgetEstimate: TripBudgetEstimate | null;
  budgetEstimateError: string | null;
  destinationOptions: DestinationOption[];
  webDestinationOptions: DestinationOption[];
  isSearchingWebDestinations: boolean;
  webDestinationError: string | null;
  onChange: <Key extends keyof FormState>(key: Key, value: FormState[Key]) => void;
  onDestinationQueryChange: (value: string) => void;
  onSelectDestination: (destination: string) => void;
  onRemoveDestination: (destination: string) => void;
  onSearchWebDestinations: () => void;
  onAddTraveler: () => void;
  onRemoveTraveler: (traveler: string) => void;
  onToggleCurrencyPicker: () => void;
  onSelectCurrency: (currency: string) => void;
  isGeneratingName: boolean;
  nameError: string | null;
  hasGeneratedName: boolean;
  canGenerateName: boolean;
  onGenerateName: () => void;
  onEstimateBudget: () => void;
  onUseBudgetEstimate: () => void;
  onDateFieldPress: (field: DateField) => void;
  onDateChange: (field: DateField, date: Date) => void;
  onDismissPicker: () => void;
  onCreateTrip: () => void;
}) {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t, locale, formatCurrency } = useLocalization();
  const budgetCurrencyAffix = getCurrencyAffix(locale, currency);
  return (
    <View style={styles.stack}>
      <View style={styles.heroHeader}>
        <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>
          {t("trip.createEyebrow")}
        </Text>
        <Text style={[styles.heroTitle, { color: theme.inkDeep }]}>
          {t("trip.createTitle")}
        </Text>
        <Text style={[styles.heroBody, { color: theme.inkSoft }]}>
          {t("trip.createBody")}
        </Text>
      </View>

      <View style={[styles.formCard, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
        <DestinationSelector
          label={t("trip.destination")}
          value={form.destinationQuery}
          placeholder={t("trip.destinationPlaceholder")}
          selectedDestinations={form.destinations}
          offlineOptions={destinationOptions}
          webOptions={webDestinationOptions}
          isSearchingWeb={isSearchingWebDestinations}
          webError={webDestinationError}
          onChangeText={onDestinationQueryChange}
          onSelect={onSelectDestination}
          onRemove={onRemoveDestination}
          onSearchWeb={onSearchWebDestinations}
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
              onPress={() => onDateFieldPress("start")}
              onDateChange={(date) => onDateChange("start", date)}
              onDismiss={onDismissPicker}
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
              onPress={() => onDateFieldPress("end")}
              onDateChange={(date) => onDateChange("end", date)}
              onDismiss={onDismissPicker}
            />
          </View>
        </View>

        <TripTextInput
          label={t("trip.budget")}
          labelMeta={currency}
          onLabelMetaPress={onToggleCurrencyPicker}
          prefix={budgetCurrencyAffix.prefix}
          suffix={budgetCurrencyAffix.suffix}
          value={form.budget}
          placeholder={t("trip.budgetPlaceholder")}
          keyboardType="numeric"
          onChangeText={(value) => onChange("budget", value.replace(/[^0-9.]/g, ""))}
        />
        {isCurrencyPickerOpen ? (
          <View style={styles.currencyGrid}>
            {CURRENCY_OPTIONS.map((option) => {
              const isActive = option.code === currency;
              return (
                <Pressable
                  key={option.code}
                  onPress={() => onSelectCurrency(option.code)}
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
          error={nameError ?? null}
          canGenerate={canGenerateName}
          onChangeText={(value) => onChange("name", value)}
          onGenerate={onGenerateName}
        />

        {shouldShowBudgetEstimate ? (
          <BudgetEstimateCard
            estimate={budgetEstimate}
            error={budgetEstimateError}
            isLoading={isEstimatingBudget}
            canEstimate={form.destinations.length > 0}
            formattedTotal={
              budgetEstimate
                ? formatCurrency(budgetEstimate.total, currency, {
                    maximumFractionDigits: 0,
                  })
                : null
            }
            formattedDaily={
              budgetEstimate
                ? formatCurrency(budgetEstimate.daily, currency, {
                    maximumFractionDigits: 0,
                  })
                : null
            }
            onEstimate={onEstimateBudget}
            onUseEstimate={onUseBudgetEstimate}
          />
        ) : null}

        <View style={styles.segmentWrap}>
          <ModeButton
            active={form.mode === "solo"}
            icon="compass"
            title={t("trip.solo")}
            subtitle={t("trip.soloSub")}
            onPress={() => onChange("mode", "solo")}
          />
          <ModeButton
            active={form.mode === "group"}
            icon="users"
            title={t("trip.group")}
            subtitle={t("trip.groupSub")}
            onPress={() => onChange("mode", "group")}
          />
        </View>

        {form.mode === "group" ? (
          <TravelerSelector
            label={t("trip.travelers")}
            value={form.travelerName}
            travelers={form.companions}
            placeholder={t("trip.travelersPlaceholder")}
            onChangeText={(value) => onChange("travelerName", value)}
            onAdd={onAddTraveler}
            onRemove={onRemoveTraveler}
          />
        ) : null}
      </View>

      <Pressable
        onPress={onCreateTrip}
        style={({ pressed }) => [
          styles.createButton,
          {
            backgroundColor: theme.teal,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
      >
        <Icon name="flag" size={18} color={theme.inverse} />
        <Text style={[styles.createButtonText, { color: theme.inverse }]}>
          {t("trip.createAction")}
        </Text>
      </Pressable>

      <Text style={[styles.encryptedNote, { color: theme.inkMuted }]}>
        {t("trip.encryptedNote")}
      </Text>
    </View>
  );
}

function TripDashboard({
  trip,
  user,
  userLocation,
  locale,
  formatCurrency,
  formatDate,
}: {
  trip: Trip;
  user: ReturnType<typeof useAuthStore.getState>["user"];
  userLocation: {
    city?: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  locale: string;
  formatCurrency: (amount: number, currency?: string) => string;
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const router = useRouter();
  const startDate = useMemo(() => fromDateKey(trip.startDate), [trip.startDate]);
  const endDate = useMemo(() => fromDateKey(trip.endDate), [trip.endDate]);
  const duration = countInclusiveDays(startDate, endDate);
  const progress = getTripProgress(trip);
  const expenseSummary = useTripExpenseSummary(trip);
  const companionCount = trip.mode === "group" ? trip.companions.length : 0;
  const safetyStatus: "idle" | "active" | "emergency" =
    progress.status === "active" ? "active" : "idle";

  const statusColors =
    safetyStatus === "active"
      ? { bg: theme.mustardSoft, fg: theme.mustard }
      : { bg: theme.tealSoft, fg: theme.teal };

  const today = new Date();
  const hour = today.getHours();
  const greetingKey =
    hour < 12 ? "trip.goodMorning" : hour < 17 ? "trip.goodAfternoon" : "trip.goodNight";

  const dayFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const fullDateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const budgetRemaining = Math.max(0, trip.budget - expenseSummary.total);

  const currentIndex = Math.max(0, Math.min(progress.day - 1, trip.destinations.length - 1));
  const currentTripLocation = trip.destinations[currentIndex] ?? "";
  const currentLocation = userLocation?.city
    ? [userLocation.city, userLocation.country].filter(Boolean).join(", ")
    : currentTripLocation;
  const nextDestination =
    trip.destinations[progress.day] ??
    trip.destinations[trip.destinations.length - 1] ??
    trip.destinations[0] ??
    "—";

  const userName = user?.name?.split(" ")[0] ?? t("common.fallbackUser");

  return (
    <View style={styles.stack}>
      <View style={styles.greetingHeader}>
        <View style={styles.greetingTop}>
          <View>
            <Text style={[styles.greetingEyebrow, { color: theme.inkMuted }]}>
              {fullDateFormatter.format(today)} · {t("trip.dayProgress", { day: progress.day, total: duration })}
            </Text>
            <Text style={[styles.greetingTitle, { color: theme.inkDeep }]}>
              {t(greetingKey)},
            </Text>
            <Text style={[styles.greetingTitle, { color: theme.inkDeep }]}>
              <Text style={[styles.greetingTitleAccent, { color: theme.inkDeep }]}>
                {userName}
              </Text>
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [styles.avatarButton, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: theme.mustard,
                  borderColor: theme.paperSoft,
                },
              ]}
            >
              <Text style={[styles.avatarText, { color: theme.inverse }]}>
                {userName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View
              style={[
                styles.avatarBadge,
                { backgroundColor: theme.teal, borderColor: theme.paper },
              ]}
            />
          </Pressable>
        </View>

        <View style={styles.progressBarSection}>
          <View style={[styles.progressBarTrack, { backgroundColor: theme.hairline }]}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${progress.percent}%`,
                  backgroundColor: theme.teal,
                },
              ]}
            />
            <View
              style={[
                styles.progressBarThumb,
                {
                  left: `${progress.percent}%`,
                  borderColor: theme.mustard,
                  backgroundColor: theme.inverse,
                },
              ]}
            />
          </View>
          <View style={styles.progressBarLabels}>
            <Text style={[styles.progressBarLabel, { color: theme.inkMuted }]}>
              {dayFormatter.format(startDate)} · {t("trip.start")}
            </Text>
            <Text style={[styles.progressBarLabelActive, { color: theme.mustard }]}>
              {progress.status === "upcoming"
                ? t("trip.startsIn", { count: Math.max(1, countInclusiveDays(today, startDate) - 1) })
                : progress.status === "complete"
                  ? t("trip.completed")
                  : `${t("trip.dayProgress", { day: progress.day, total: duration })} · ${currentLocation}`}
            </Text>
            <Text style={[styles.progressBarLabel, { color: theme.inkMuted }]}>
              {dayFormatter.format(endDate)} · {t("trip.end")}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.homeTripCard,
          { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
        ]}
      >
        <View style={styles.homeTripHeader}>
          <View style={styles.homeTripHeaderLeft}>
            <Text style={[styles.homeTripLabel, { color: theme.inkMuted }]}>
              {t("trip.currentTrip")}
            </Text>
            <Pressable
              onPress={() => router.push("/trips")}
              style={({ pressed }) => [
                styles.switchPill,
                { backgroundColor: theme.tealSoft, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Icon name="swap" size={10} color={theme.teal} />
              <Text style={[styles.switchPillText, { color: theme.teal }]}>
                {t("trip.switch")}
              </Text>
            </Pressable>
          </View>
          <View
            style={[styles.homeTripStatusPill, { backgroundColor: statusColors.bg }]}
          >
            <View style={[styles.homeTripStatusDot, { backgroundColor: statusColors.fg }]} />
            <Text style={[styles.homeTripStatusText, { color: statusColors.fg }]}>
              {safetyStatus === "active" ? t("trip.tracking") : t("trip.idle")}
            </Text>
          </View>
        </View>

        <Text style={[styles.homeTripName, { color: theme.inkDeep }]}>
          {trip.name}
        </Text>
        <Text style={[styles.homeTripSub, { color: theme.inkSoft }]}>
          {formatDate(startDate)} — {formatDate(endDate)} ·{" "}
          {trip.mode === "solo" ? t("trip.solo") : t("trip.groupWithCount", { count: companionCount + 1 })} ·{" "}
          {trip.destinations.length} {t("trip.countries")}
        </Text>

        <View style={[styles.mapPlaceholder, { backgroundColor: theme.paper }]}>
          <TripMap
            trip={trip}
            userLocation={userLocation}
            currentIndex={currentIndex}
            theme={theme}
            t={t}
          />
        </View>

        <View style={styles.homeTripMetrics}>
          <View style={[styles.homeTripMetric, { backgroundColor: theme.paper }]}>
            <Text style={[styles.homeTripMetricLabel, { color: theme.inkMuted }]}>
              {progress.status === "upcoming" ? t("trip.starts") : progress.status === "complete" ? t("trip.ended") : t("trip.next")}
            </Text>
            <Text style={[styles.homeTripMetricValue, { color: theme.inkDeep }]} numberOfLines={1}>
              {progress.status === "upcoming" ? formatDate(startDate) : progress.status === "complete" ? formatDate(endDate) : nextDestination}
            </Text>
            <Text style={[styles.homeTripMetricSub, { color: theme.inkSoft }]}>
              {progress.status === "upcoming"
                ? t("trip.inDays", { count: Math.max(1, countInclusiveDays(today, startDate) - 1) })
                : progress.status === "complete"
                  ? t("trip.daysAgo", { count: Math.max(1, countInclusiveDays(endDate, today) - 1) })
                  : t("trip.inDays", { count: progress.day + 1 })}
            </Text>
          </View>
          <View style={[styles.homeTripMetric, { backgroundColor: theme.paper }]}>
            <Text style={[styles.homeTripMetricLabel, { color: theme.inkMuted }]}>
              {t("trip.remaining")}
            </Text>
            <Text style={[styles.homeTripMetricValue, { color: theme.inkDeep }]}>
              {formatCurrency(budgetRemaining, trip.currency)}
            </Text>
            <Text style={[styles.homeTripMetricSub, { color: theme.inkSoft }]}>
              {t("trip.ofBudget", { total: formatCurrency(trip.budget, trip.currency) })}
            </Text>
          </View>
        </View>
      </View>

      <TripWeather trip={trip} userLocation={userLocation} currentIndex={currentIndex} />

      <TripItinerary trip={trip} />

      <NearbyPlaces userLocation={userLocation} />
    </View>
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
          <Pressable
            onPress={onLabelMetaPress}
            disabled={!onLabelMetaPress}
            hitSlop={8}
          >
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
  const isAndroid = process.env.EXPO_OS === "android";
  const isIOS = process.env.EXPO_OS === "ios";

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

function TripMap({
  trip,
  userLocation,
  currentIndex,
  theme,
  t,
}: {
  trip: Trip;
  userLocation: { latitude?: number; longitude?: number } | null;
  currentIndex: number;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
  t: ReturnType<typeof useLocalization>["t"];
}) {
  const mapRef = useRef<MapView>(null);
  const destinations = useMemo(() => trip.destinationCoordinates ?? [], [trip.destinationCoordinates]);
  const userCoords = useMemo((): LatLng | null => {
    const lat = userLocation?.latitude;
    const lon = userLocation?.longitude;
    if (lat != null && lon != null) {
      return { latitude: lat, longitude: lon };
    }
    return null;
  }, [userLocation?.latitude, userLocation?.longitude]);
  const allPoints = useMemo((): LatLng[] => {
    return userCoords ? [userCoords, ...destinations] : destinations;
  }, [destinations, userCoords]);
  const hasAnyCoords = allPoints.length > 0;

  const destinationRoutePath = useMemo((): LatLng[] => {
    const points = userCoords ? [userCoords, ...destinations] : destinations;
    if (points.length < 2) return points;

    const result: LatLng[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      result.push(start);
      const mid = {
        latitude: (start.latitude + end.latitude) / 2 + (end.longitude - start.longitude) * 0.12,
        longitude: (start.longitude + end.longitude) / 2 - (start.latitude - end.latitude) * 0.12,
      };
      const steps = 16;
      for (let s = 1; s < steps; s += 1) {
        const t1 = s / steps;
        const t2 = 1 - t1;
        result.push({
          latitude: t2 * t2 * start.latitude + 2 * t2 * t1 * mid.latitude + t1 * t1 * end.latitude,
          longitude: t2 * t2 * start.longitude + 2 * t2 * t1 * mid.longitude + t1 * t1 * end.longitude,
        });
      }
    }
    result.push(points[points.length - 1]);
    return result;
  }, [destinations, userCoords]);

  const initialRegion = useMemo((): Region => {
    if (allPoints.length === 0) {
      return {
        latitude: 20,
        longitude: 0,
        latitudeDelta: 120,
        longitudeDelta: 120,
      };
    }

    const minLat = Math.min(...allPoints.map((p) => p.latitude));
    const maxLat = Math.max(...allPoints.map((p) => p.latitude));
    const minLon = Math.min(...allPoints.map((p) => p.longitude));
    const maxLon = Math.max(...allPoints.map((p) => p.longitude));

    const latDelta = Math.max(10, (maxLat - minLat) * 1.8 + 4);
    const lonDelta = Math.max(10, (maxLon - minLon) * 1.8 + 4);

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    };
  }, [allPoints]);

  const fitMap = useCallback(() => {
    if (!mapRef.current || allPoints.length === 0) return;

    const edgePadding = { top: 80, right: 80, bottom: 80, left: 80 };

    if (allPoints.length === 1) {
      mapRef.current.animateToRegion(
        {
          ...allPoints[0],
          latitudeDelta: 2,
          longitudeDelta: 2,
        },
        500,
      );
      return;
    }

    // Use raw markers (not the curved route polyline) for fitting so Android
    // Google Maps reliably includes every destination pin in the viewport.
    const fitPoints =
      destinations.length > 0
        ? userCoords
          ? [userCoords, ...destinations]
          : destinations
        : allPoints;

    mapRef.current.fitToCoordinates(fitPoints, {
      edgePadding,
      animated: true,
    });
  }, [allPoints, destinations, userCoords]);


  useEffect(() => {
    const timer = setTimeout(fitMap, Platform.OS === "android" ? 600 : 300);
    return () => clearTimeout(timer);
  }, [fitMap]);

  useEffect(() => {
    // Android sometimes ignores the first fitToCoordinates call while the map
    // is still laying out; retry once after a short delay when points change.
    if (Platform.OS !== "android" || allPoints.length === 0) return;

    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        destinations.length > 0
          ? userCoords
            ? [userCoords, ...destinations]
            : destinations
          : allPoints,
        { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true },
      );
    }, 900);
    return () => clearTimeout(timer);
  }, [allPoints, destinations, userCoords]);

  if (!hasAnyCoords) {
    return (
      <View style={styles.mapFallback}>
        <Icon name="globe" size={34} color={theme.inkMuted} />
        <Text style={[styles.mapFallbackText, { color: theme.inkMuted }]}>
          {t("trip.mapNoCoordinates")}
        </Text>
      </View>
    );
  }

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_DEFAULT}
      initialRegion={initialRegion}
      onLayout={fitMap}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      mapType="standard"
      // On Android, tapping a marker centers it by default and can push far-away
      // destinations off-screen. Since map interactions are already disabled,
      // ignoring marker selections keeps the original fitted view intact.
      onMarkerSelect={() => {
        if (Platform.OS === "android") {
          // Returning nothing/undefined keeps native default behavior. Instead,
          // we re-fit after a short delay so every destination stays visible.
          setTimeout(() => fitMap(), 150);
        }
      }}
    >
      {destinationRoutePath.length > 1 ? (
        <Polyline
          coordinates={destinationRoutePath}
          strokeColor={theme.inkSoft}
          strokeWidth={2.5}
          lineDashPattern={[6, 6]}
          zIndex={1}
        />
      ) : null}
      {userCoords ? (
        <Marker
          coordinate={userCoords}
          title={t("trip.currentLocation")}
          pinColor={theme.teal}
        />
      ) : null}
      {destinations.map((coord, index) => (
        <Marker
          key={`${trip.id}-dest-${index}`}
          coordinate={coord}
          title={trip.destinations[index] ?? t("trip.destination")}
          pinColor={index === currentIndex ? theme.mustard : theme.stamp}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
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
    gap: 2,
  },
  currencyCode: {
    fontFamily: NOMAD_FONTS.monoMedium,
    fontSize: 13,
    letterSpacing: 0.6,
  },
  currencyName: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11.5,
    lineHeight: 15,
  },
  aiBudgetCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  aiBudgetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  aiBudgetIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
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
    fontSize: 12.5,
    lineHeight: 17,
  },
  aiBudgetReason: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  aiBudgetActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  aiBudgetButton: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  aiBudgetButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 12.5,
  },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  dateSection: {
    gap: 9,
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
    gap: 8,
  },
  dateButton: {
    flex: 1,
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 12,
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
  },
  dateLabel: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 12.5,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  dateValue: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: 0,
  },
  dateSubValue: {
    fontFamily: NOMAD_FONTS.uiMedium,
    fontSize: 11.5,
  },
  dateConnector: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  dateConnectorLine: {
    width: 1,
    height: 18,
  },
  dateConnectorDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  dateSheetBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  dateSheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 12,
  },
  dateSheetGrabber: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 999,
  },
  dateSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateSheetLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  dateSheetTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 28,
    lineHeight: 32,
  },
  dateDoneButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dateDoneText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
  dateSheetHost: {
    minHeight: 330,
  },
  segmentWrap: {
    flexDirection: "row",
    gap: 10,
  },
  modeButton: {
    flex: 1,
    minHeight: 78,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  modeIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  modeCopy: {
    flex: 1,
    gap: 2,
  },
  modeTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14.5,
  },
  modeSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11,
    lineHeight: 14,
  },
  modeCheck: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  createButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  createButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
  },
  encryptedNote: {
    textAlign: "center",
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  nameError: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12.5,
    lineHeight: 17,
  },
  tripHeroCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  tripHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tripHeroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  greetingHeader: {
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 16,
  },
  greetingTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greetingEyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  greetingTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.7,
    marginTop: 6,
  },
  greetingTitleAccent: {
    fontStyle: "italic",
  },
  avatarButton: {
    position: "relative",
    borderRadius: 999,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
  },
  avatarBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  progressBarSection: {
    gap: 8,
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 999,
    position: "relative",
    overflow: "hidden",
  },
  progressBarFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  progressBarThumb: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    transform: [{ translateX: -8 }],
  },
  progressBarLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressBarLabel: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  progressBarLabelActive: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.3,
    fontWeight: "700",
  },
  homeTripCard: {
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
    padding: 16,
    gap: 10,
  },
  homeTripHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 2,
  },
  homeTripHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  homeTripLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  switchPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  switchPillText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9,
    letterSpacing: 0.4,
  },
  homeTripStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  homeTripStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  homeTripStatusText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 10.5,
    letterSpacing: 0.3,
  },
  homeTripName: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  homeTripSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  mapPlaceholder: {
    height: 200,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    position: "relative",
    overflow: "hidden",
  },
  map: {
    width: "100%",
    height: "100%",
  },
  mapFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  mapFallbackText: {
    fontFamily: NOMAD_FONTS.uiMedium,
    fontSize: 13,
    textAlign: "center",
  },
  homeTripMetrics: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  homeTripMetric: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  homeTripMetricLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  homeTripMetricValue: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.3,
  },
  homeTripMetricSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 10,
    lineHeight: 14,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
  },
  tripHeroTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 27,
    lineHeight: 31,
    letterSpacing: 0,
  },
  tripHeroSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  progressMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 11,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    width: "48.5%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
    gap: 8,
  },
  metricIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  metricLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metricValue: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
  },
  detailsCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  detailsHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  detailIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsCopy: {
    flex: 1,
  },
  detailsTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
  detailsSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 3,
  },
});
