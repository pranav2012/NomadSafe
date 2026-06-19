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
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useSettingsStore } from "@/features/settings";
import {
  type DestinationOption,
  normalizeSearchText,
  searchOfflineDestinations,
} from "@/features/trips/data/destinations";
import {
  type Trip,
  type TripMode,
  useTripsStore,
} from "@/features/trips/store/tripsStore";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
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

function formatDestinationList(destinations: string[]) {
  return destinations.join(" • ");
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
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t, locale, formatCurrency, formatDate } = useLocalization();
  const defaultCurrency = useSettingsStore((state) => state.defaultCurrency);
  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const createTrip = useTripsStore((state) => state.createTrip);
  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? trips[0] ?? null;
  const [form, setForm] = useState<FormState>(() => makeInitialForm(defaultCurrency));
  const [pickerField, setPickerField] = useState<DateField | null>(null);
  const [isCurrencyPickerOpen, setIsCurrencyPickerOpen] = useState(false);
  const [webDestinationResults, setWebDestinationResults] = useState<DestinationOption[]>([]);
  const [isSearchingWebDestinations, setIsSearchingWebDestinations] = useState(false);
  const [webDestinationError, setWebDestinationError] = useState<string | null>(null);

  const offlineDestinationResults = useMemo(
    () => searchOfflineDestinations(form.destinationQuery, locale, form.destinations),
    [form.destinationQuery, form.destinations, locale],
  );

  const updateForm = <Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) => setForm((current) => ({ ...current, [key]: value }));

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
  };

  const handleRemoveDestination = (destination: string) => {
    setForm((current) => ({
      ...current,
      destinations: current.destinations.filter((item) => item !== destination),
    }));
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
  };

  const handleRemoveTraveler = (traveler: string) => {
    setForm((current) => ({
      ...current,
      companions: current.companions.filter((companion) => companion !== traveler),
    }));
  };

  const handleSelectCurrency = (currency: string) => {
    updateForm("currency", currency);
    setIsCurrencyPickerOpen(false);
  };

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
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.root, { backgroundColor: theme.paper }]}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {activeTrip ? (
          <TripDashboard
            trip={activeTrip}
            isDark={isDark}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
          />
        ) : (
          <CreateTripForm
            form={form}
            pickerField={pickerField}
            currency={form.currency}
            isCurrencyPickerOpen={isCurrencyPickerOpen}
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
  onDateFieldPress,
  onDateChange,
  onDismissPicker,
  onCreateTrip,
}: {
  form: FormState;
  pickerField: DateField | null;
  currency: string;
  isCurrencyPickerOpen: boolean;
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
  onDateFieldPress: (field: DateField) => void;
  onDateChange: (field: DateField, date: Date) => void;
  onDismissPicker: () => void;
  onCreateTrip: () => void;
}) {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();
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
        <TripTextInput
          label={t("trip.tripName")}
          value={form.name}
          placeholder={t("trip.tripNamePlaceholder")}
          onChangeText={(value) => onChange("name", value)}
        />
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
  isDark,
  formatCurrency,
  formatDate,
}: {
  trip: Trip;
  isDark: boolean;
  formatCurrency: (amount: number, currency?: string) => string;
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const startDate = useMemo(() => fromDateKey(trip.startDate), [trip.startDate]);
  const endDate = useMemo(() => fromDateKey(trip.endDate), [trip.endDate]);
  const destinationSummary = formatDestinationList(trip.destinations);
  const duration = countInclusiveDays(startDate, endDate);
  const progress = getTripProgress(trip);
  const dailyBudget = trip.budget / duration;
  const companionCount = trip.mode === "group" ? trip.companions.length : 0;
  const statusLabel =
    progress.status === "active"
      ? t("trip.activeNow")
      : progress.status === "upcoming"
        ? t("trip.upcoming")
        : t("trip.completed");

  return (
    <View style={styles.stack}>
      <View style={styles.heroHeader}>
        <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>
          {t("trip.dashboardEyebrow")}
        </Text>
        <Text style={[styles.heroTitle, { color: theme.inkDeep }]}>
          {trip.name}
        </Text>
        <Text style={[styles.heroBody, { color: theme.inkSoft }]}>
          {destinationSummary}
        </Text>
      </View>

      <View
        style={[
          styles.tripHeroCard,
          {
            backgroundColor: theme.inkDeep,
            borderColor: isDark ? theme.hairline : theme.inkDeep,
          },
        ]}
      >
        <View style={styles.tripHeroTop}>
          <View style={[styles.heroIcon, { backgroundColor: theme.whiteOverlay }]}>
            <Icon name="mapPin" size={21} color={theme.paperSoft} />
          </View>
          <View style={[styles.statusPill, { backgroundColor: theme.whiteOverlay }]}>
            <Text style={[styles.statusPillText, { color: theme.paperSoft }]}>
              {statusLabel}
            </Text>
          </View>
        </View>
        <Text style={[styles.tripHeroTitle, { color: theme.paperSoft }]}>
          {formatDate(startDate)} - {formatDate(endDate)}
        </Text>
        <Text style={[styles.tripHeroSub, { color: theme.whiteTextMuted }]}>
          {t("trip.durationSummary", { count: duration })}
        </Text>

        <View style={[styles.progressTrack, { backgroundColor: theme.whiteOverlay }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progress.percent}%`,
                backgroundColor: theme.mustard,
              },
            ]}
          />
        </View>
        <View style={styles.progressMeta}>
          <Text style={[styles.progressText, { color: theme.whiteTextMuted }]}>
            {t("trip.dayProgress", { day: progress.day, total: progress.totalDays })}
          </Text>
          <Text style={[styles.progressText, { color: theme.whiteTextMuted }]}>
            {Math.round(progress.percent)}%
          </Text>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard
          icon="wallet"
          label={t("trip.totalBudget")}
          value={formatCurrency(trip.budget, trip.currency)}
        />
        <MetricCard
          icon="clock"
          label={t("trip.dailyBudget")}
          value={formatCurrency(dailyBudget, trip.currency)}
        />
        <MetricCard
          icon={trip.mode === "solo" ? "compass" : "users"}
          label={t("trip.travelMode")}
          value={trip.mode === "solo" ? t("trip.solo") : t("trip.group")}
        />
        <MetricCard
          icon="lock"
          label={t("trip.storage")}
          value={t("trip.onDevice")}
        />
      </View>

      {trip.mode === "group" ? (
        <View style={[styles.detailsCard, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
          <View style={styles.detailsHeader}>
            <View style={[styles.detailIcon, { backgroundColor: theme.tealSoft }]}>
              <Icon name="users" size={18} color={theme.teal} />
            </View>
            <View>
              <Text style={[styles.detailsTitle, { color: theme.inkDeep }]}>
                {t("trip.companionSummary", { count: companionCount })}
              </Text>
              <Text style={[styles.detailsSub, { color: theme.inkSoft }]}>
                {companionCount > 0
                  ? trip.companions.join(", ")
                  : t("trip.noCompanions")}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      <View style={[styles.detailsCard, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
        <View style={styles.detailsHeader}>
          <View style={[styles.detailIcon, { backgroundColor: theme.mustardSoft }]}>
            <Icon name="shield" size={18} color={theme.mustard} />
          </View>
          <View style={styles.detailsCopy}>
            <Text style={[styles.detailsTitle, { color: theme.inkDeep }]}>
              {t("trip.nextSetupTitle")}
            </Text>
            <Text style={[styles.detailsSub, { color: theme.inkSoft }]}>
              {t("trip.nextSetupBody")}
            </Text>
          </View>
        </View>
      </View>
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

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: "wallet" | "clock" | "compass" | "users" | "lock";
  label: string;
  value: string;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;

  return (
    <View style={[styles.metricCard, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
      <View style={[styles.metricIcon, { backgroundColor: theme.tealSoft }]}>
        <Icon name={icon} size={17} color={theme.teal} />
      </View>
      <Text style={[styles.metricLabel, { color: theme.inkMuted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: theme.inkDeep }]}>{value}</Text>
    </View>
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
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
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
