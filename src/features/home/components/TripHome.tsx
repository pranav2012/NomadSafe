import React, { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrivateView, track } from "@/modules/analytics";
import { LinearGradient } from "expo-linear-gradient";
import { AuraButton, Icon, PressableScale, RollingNumber, useTabBarInset, AuraTopFade } from "@/atoms";
import { useGmailStatus } from "@/features/expenses/hooks/useGmailStatus";
import { useScrollActivity } from "@/hooks/useScrollActivity";
import { auraDark, auraFonts as f, auraLight, auraStatusAccent, auraStatusColors, type AuraStatus } from "@/constants/aura";
import { useGlobeContext } from "@/features/home/hooks/useGlobeContext";
import { useHotelPin, useSafetyPlaces } from "@/features/home/hooks/useTripSafety";
import type { HomeData } from "@/features/home/types";
import { todayStopIndex } from "@/features/home/utils/globeTiles";
import { TripItinerary, useEventsStore } from "@/features/itinerary";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { useRouter } from "expo-router";
import { useLivePass } from "@/features/home/hooks/useLivePass";
import { homeStage } from "@/features/home/utils/stage";
import { addDays, fromDateKey } from "@/features/trips/utils/dates";
import { useNow } from "@/hooks/useNow";
import { useRecapStore } from "@/features/recap";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { NearbyPlaces } from "@/features/places/components/NearbyPlaces";
import { useTripForecast } from "@/features/trips/hooks/useTripForecast";
import { describeWeather } from "@/features/trips/services/weatherService";
import { WeatherSheet } from "./WeatherSheet";
import { TripPrepCard } from "./TripPrepCard";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { ActionButton } from "./aura/ActionButton";
import { BoardingPass } from "./aura/BoardingPass";
import { DayRail } from "./aura/DayRail";
import { Globe } from "./aura/globe/Globe";
import { distanceKm } from "./aura/globe/sun";
import { InlineSafetyMap } from "./aura/safety/InlineSafetyMap";
import { SpendChart } from "./aura/SpendChart";

// Hero height (below the header) for the horizon strip during the trip.
const HORIZON_HEIGHT = 150;

export interface UserLocation {
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

interface TripHomeProps {
  trip: Trip;
  data: HomeData;
  isDark: boolean;
  status: AuraStatus;
  userLocation: UserLocation | null;
  checkInActive: boolean;
  onAddSpend: () => void;
  onImportSpends: (source: "gmail" | "paste") => void;
  onCheckIn: () => void;
  onToggleShare: () => void;
  onSos: () => void;
  onSwitchTrip: () => void;
  onOpenSettings: () => void;
  /** Rendered above the trip pass, e.g. the recap card once the trip has ended. */
  topSlot?: React.ReactNode;
}

/**
 * Home for an active trip: a live globe (where you are vs. the trip, day/night, people sharing
 * with you), the trip pass (flips to emergency info), day rail, spend, quick actions, what's next,
 * and the older weather / itinerary / nearby sections re-themed to match.
 */
export function TripHome({
  trip,
  data,
  isDark,
  status,
  userLocation,
  checkInActive,
  onAddSpend,
  onImportSpends,
  onCheckIn,
  onToggleShare,
  onSos,
  onSwitchTrip,
  onOpenSettings,
  topSlot,
}: TripHomeProps) {
  const gmail = useGmailStatus();
  const c = isDark ? auraDark : auraLight;
  const accent = auraStatusAccent[status];
  // The globe and the pass keep the calm look; sharing / SOS only recolour the rest of the page.
  const heroAccent = auraStatusAccent.calm;
  const { t, formatTemperature } = useLocalization();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { width } = useWindowDimensions();
  const forecast = useTripForecast(trip, userLocation);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [railDay, setRailDay] = useState<number | null>(null);
  const [spendDay, setSpendDay] = useState<number | null>(null);
  const replayOpen = useRecapStore((state) => state.replayOpen);
  const allEvents = useEventsStore((state) => state.events);
  const tripEvents = allEvents.filter((event) => event.tripId === trip.id);
  const now = useNow();
  const stage = homeStage(trip, now);
  // The day before and during the trip, Home leads with the day's plan and the globe shrinks to a horizon.
  const liveMode = stage === "active" || stage === "eve";
  const [globeExpanded, setGlobeExpanded] = useState(false);
  const horizon = liveMode && !globeExpanded;
  const todayIndex = stage === "active" ? Math.max(0, data.day - 1) : 0;
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const selectedIndex = pickedDay ?? todayIndex;
  const selectedDate = addDays(fromDateKey(trip.startDate), selectedIndex);

  const globeHeight = Math.round(width * 0.8);
  const headerSpace = insets.top + 62;
  const here = userLocation?.latitude != null && userLocation.longitude != null ? { latitude: userLocation.latitude, longitude: userLocation.longitude } : null;
  const focusIndex = todayStopIndex(data.stops, data.phase, data.day, data.totalDays, here);
  const focusStop = data.stops[focusIndex];
  const globe = useGlobeContext(focusStop);
  const selectedStop = pickedDay === null ? focusStop : data.stops[todayStopIndex(data.stops, "active", selectedIndex + 1, data.totalDays, null)];
  const live = useLivePass({ events: tripEvents, now, stage, day: data.day, totalDays: data.totalDays, city: focusStop?.name.split(",")[0] });
  const heroHeight = horizon ? HORIZON_HEIGHT : globeHeight;
  const router = useRouter();
  const tickets = useTicketsStore((state) => state.tickets);
  const ticketEventIds = new Set(tickets.map((ticket) => ticket.eventId));
  const ticketEvent = live ? tripEvents.find((event) => event.id === live.eventIds.find((id) => ticketEventIds.has(id))) : undefined;

  const selectDay = (index: number) => {
    setPickedDay(index === todayIndex ? null : index);
    track("itinerary_day_viewed", { relative_day: index - todayIndex });
  };
  const safetyPlaces = useSafetyPlaces(focusStop);
  const hotel = useHotelPin(focusStop, data.stayName ?? undefined);
  const [contacts] = useState(() => emergencyContactsStorage.get());

  const nearest = (kind: "hospital" | "police") => {
    if (!focusStop || !safetyPlaces) return null;
    return (
      safetyPlaces
        .filter((place) => place.kind === kind)
        .map((place) => ({ place, km: distanceKm(focusStop, place) }))
        .sort((a, b) => a.km - b.km)[0] ?? null
    );
  };
  const emergency = {
    hospital: nearest("hospital"),
    police: nearest("police"),
    stayName: data.stayName,
    contacts,
    loading: Boolean(focusStop) && safetyPlaces === null,
  };

  const lead = forecast.active?.days[0];
  const weatherLabel = lead
    ? `${describeWeather(lead.weatherCode).emoji} ${formatTemperature(lead.tempMax)} · ${t(`trip.weatherConditions.${describeWeather(lead.weatherCode).labelKey}`)}`
    : null;
  const chips: {
    icon?: "mapPin" | "clock" | "users";
    label: string;
    onPress?: () => void;
  }[] = [
    weatherLabel
      ? {
          label: weatherLabel,
          onPress: () => setWeatherOpen(true),
        }
      : null,
    globe.distanceLabel ? { icon: "mapPin" as const, label: globe.distanceLabel } : null,
    globe.daylightLabel ? { icon: "clock" as const, label: globe.daylightLabel } : null,
    globe.contacts.length > 0
      ? {
          icon: "users" as const,
          label: t("home.sharingWithYou", { count: globe.contacts.length }),
        }
      : null,
  ].filter((chip): chip is NonNullable<typeof chip> => chip !== null);

  const upcoming = data.countdown !== null;
  const railCaption = railDay !== null ? data.dayDates[railDay] : upcoming ? data.dayLabel : data.daysLeftLabel;
  const scrubbedSpend = spendDay !== null ? data.spendDays[spendDay] : null;
  const nothingSpent = data.spendDays.every((d) => d.amount === 0);
  const showChart = !nothingSpent;
  const [hero, setHero] = useState<
    | { mode: "globe"; entry: { latitude: number; longitude: number } | null }
    | {
        mode: "map";
        center: { latitude: number; longitude: number };
        radiusPx: number;
      }
  >({ mode: "globe", entry: null });
  const [heroTouched, setHeroTouched] = useState(false);
  const { scrolling, onScroll } = useScrollActivity();
  // The header sits over the globe's dark space backdrop in globe mode, even in light mode.
  const hc = hero.mode === "globe" ? auraDark : c;

  const moneyCard =
    !data.hasSpends ? (
      <View style={[styles.moneyCard, styles.moneyEmpty, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <View style={[styles.cardHighlight, { backgroundColor: c.highlight }]} />
        <View style={styles.emptyHead}>
          <View style={[styles.emptyIcon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="wallet" size={18} color={c.text} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t("expenses.noExpensesTitle")}</Text>
            <Text style={[styles.emptyBody, { color: c.textSoft }]}>
              {!gmail.configured
                ? t("expenses.homeEmptyBodyNoGmail")
                : gmail.connected
                  ? t("expenses.homeEmptyBodyConnected")
                  : t("expenses.homeEmptyBody")}
            </Text>
          </View>
        </View>
        <View style={styles.emptyActions}>
          {gmail.configured ? (
            <AuraButton
              size="md"
              icon="mail"
              label={gmail.connected ? t("expenses.gmailFetch") : t("expenses.gmailConnect")}
              onPress={() => onImportSpends("gmail")}
              style={styles.flex}
            />
          ) : null}
          <AuraButton
            size="md"
            variant={gmail.configured ? "secondary" : "primary"}
            icon="messageCircle"
            label={t("expenses.pasteAlertShort")}
            onPress={() => onImportSpends("paste")}
            style={styles.flex}
          />
        </View>
      </View>
    ) : (
      <View style={[styles.moneyCard, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <View style={[styles.cardHighlight, { backgroundColor: c.highlight }]} />
        <View style={styles.moneyText}>
          <Text style={[styles.moneyLabel, { color: c.textMuted }]}>{scrubbedSpend ? scrubbedSpend.label : data.moneyLabel}</Text>
          <RollingNumber
            value={scrubbedSpend ? scrubbedSpend.amountLabel : data.moneyValue}
            lineHeight={42}
            style={[styles.moneyValue, { color: c.text }]}
          />
        </View>
        {showChart ? (
          <View style={styles.chart}>
            <SpendChart
              values={data.spendDays.map((d) => d.amount)}
              accent={accent}
              guide={isDark ? "rgba(255,255,255,0.2)" : "rgba(14,16,24,0.16)"}
              onScrub={setSpendDay}
              height={84}
            />
          </View>
        ) : null}
      </View>
    );

  const quickActions = (
    <View style={styles.actions}>
      <ActionButton icon="plus" label={t("expenses.addAction")} palette={c} accent={accent} onPress={onAddSpend} />
      <ActionButton
        icon="check"
        label={t("safety.factorCheckIn")}
        palette={c}
        accent={accent}
        live={checkInActive}
        onPress={onCheckIn}
      />
      <ActionButton icon="users" label={t("tabs.share")} palette={c} accent={accent} live={data.isSharing} onPress={onToggleShare} />
      <ActionButton icon="alertTriangle" label={t("settings.smsSos")} palette={c} accent={accent} onPress={onSos} />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        style={{ backgroundColor: c.bg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!heroTouched}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingBottom: tabBarInset + 24,
        }}
      >
        <View style={{ height: headerSpace + heroHeight }}>
        <View style={[styles.heroTop, { top: insets.top + 12 }]}>
          <Text numberOfLines={1} style={[styles.greeting, { color: hc.textSoft }]}>
            {data.greeting}, {data.userName}
          </Text>
          <PressableScale
            onPress={onSwitchTrip}
            accessibilityRole="button"
            accessibilityLabel={t("home.switchTrip")}
            style={[styles.round, { backgroundColor: hc.surfaceStrong, borderColor: hc.hairline }]}
          >
            <Icon name="swap" size={16} color={hc.text} />
          </PressableScale>
          <PressableScale
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel={t("settings.title")}
            style={[styles.round, { backgroundColor: hc.surfaceStrong, borderColor: hc.hairline }]}
          >
            <Text style={[styles.avatarText, { color: hc.text }]}>{data.userName.charAt(0).toUpperCase()}</Text>
          </PressableScale>
        </View>

        <PrivateView style={StyleSheet.absoluteFill}>
          {hero.mode === "globe" && replayOpen ? null : hero.mode === "globe" ? (
            <Animated.View
              key={hero.entry ? `globe-${hero.entry.latitude}` : "globe"}
              entering={FadeIn.duration(hero.entry ? 300 : 450)}
              exiting={FadeOut.duration(260)}
              accessible
              accessibilityLabel={t("home.globeHint")}
            >
              <Globe
                stops={data.stops}
                focusIndex={focusIndex}
                width={width}
                height={headerSpace + heroHeight}
                topInset={headerSpace}
                horizon={horizon}
                onPress={() => {
                  track("today_action", { action: "expand_globe" });
                  setGlobeExpanded(true);
                }}
                origin={globe.origin}
                contacts={globe.contacts}
                contactColor="#3DDC97"
                accent={heroAccent}
                isDark={isDark}
                entry={hero.entry}
                onTouchActive={setHeroTouched}
                scrolling={scrolling}
                showRoute={data.phase !== "active"}
                onZoomThrough={(center, radiusPx) => setHero({ mode: "map", center, radiusPx })}
              />
            </Animated.View>
          ) : (
            <Animated.View key="map" entering={FadeIn.duration(380)} exiting={FadeOut.duration(220)} style={[styles.map, { top: headerSpace }]}>
              <InlineSafetyMap
                height={globeHeight}
                from={{ center: hero.center, radiusPx: hero.radiusPx }}
                stop={focusStop}
                stops={data.stops}
                hotel={hotel}
                places={safetyPlaces}
                contacts={globe.contacts}
                palette={c}
                accent={heroAccent}
                isDark={isDark}
                onBackToGlobe={(center) => {
                  setHeroTouched(false);
                  setHero({ mode: "globe", entry: center });
                }}
                onTouchActive={setHeroTouched}
              />
            </Animated.View>
          )}
        </PrivateView>
        {hero.mode === "globe" ? (
          <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.heroFade} />
        ) : null}
        {liveMode && globeExpanded && hero.mode === "globe" ? (
          <PressableScale
            onPress={() => {
              track("today_action", { action: "collapse_globe" });
              setGlobeExpanded(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("home.live.showToday")}
            style={[styles.round, styles.collapse, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
          >
            <Icon name="chevronDown" size={16} color={c.text} />
          </PressableScale>
        ) : null}
        </View>

        {chips.length > 0 ? (
          <Animated.View entering={FadeIn.delay(900).duration(400)} style={styles.chips} pointerEvents="box-none">
            {chips.map((chip) => (
              <PressableScale
                key={chip.label}
                disabled={!chip.onPress}
                onPress={chip.onPress}
                haptic={Boolean(chip.onPress)}
                accessibilityRole={chip.onPress ? "button" : undefined}
                style={[styles.chip, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
              >
                {chip.icon ? <Icon name={chip.icon} size={13} color={c.textSoft} /> : null}
                <Text numberOfLines={1} style={[styles.chipText, { color: c.text }]}>
                  {chip.label}
                </Text>
                {chip.onPress ? <Icon name="chevronRight" size={12} color={c.textMuted} /> : null}
              </PressableScale>
            ))}
          </Animated.View>
        ) : null}

        {topSlot}

        <PrivateView style={styles.passWrap}>
          <BoardingPass
            data={data}
            palette={c}
            accent={heroAccent}
            gradient={auraStatusColors.calm}
            isDark={isDark}
            emergency={emergency}
            scrolling={scrolling}
            live={live}
          />
        </PrivateView>

        {ticketEvent ? (
          <View style={[styles.body, styles.ticketWrap]}>
            <PressableScale
              onPress={() => router.push({ pathname: "/ticket/[eventId]", params: { eventId: ticketEvent.id } })}
              accessibilityRole="button"
              style={[styles.ticketPill, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
            >
              <Icon name="ticket" size={15} color={c.text} />
              <Text numberOfLines={1} style={[styles.ticketText, { color: c.text }]}>
                {t("tickets.showFor", { title: localizeEventTitle(ticketEvent.title, t) })}
              </Text>
              <Icon name="chevronRight" size={13} color={c.textMuted} />
            </PressableScale>
          </View>
        ) : null}

        {stage === "upcoming" ? (
          <PrivateView style={[styles.body, styles.prep]}>
            <TripPrepCard trip={trip} events={tripEvents} firstStop={data.stops[0]} />
          </PrivateView>
        ) : null}

        <View style={styles.body}>
          <DayRail
            totalDays={data.totalDays}
            today={data.day}
            onScrub={setRailDay}
            selected={liveMode ? selectedIndex : null}
            onSelect={liveMode ? selectDay : undefined}
            height={36}
            colors={{
              past: c.textSoft,
              future: isDark ? "rgba(255,255,255,0.2)" : "rgba(14,16,24,0.16)",
              today: accent,
              selected: c.text,
            }}
          />
          <View style={styles.railLabels}>
            <Text style={[styles.railLabel, { color: c.textMuted }]}>{data.dayDates[0]}</Text>
            {railDay !== null ? (
              <Animated.Text
                key={railCaption}
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(100)}
                style={[styles.railCaption, { color: accent }]}
              >
                {railCaption}
              </Animated.Text>
            ) : liveMode && pickedDay !== null ? (
              <PressableScale
                onPress={() => {
                  track("today_action", { action: "back_to_today" });
                  setPickedDay(null);
                }}
                accessibilityRole="button"
                style={[styles.backToday, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
              >
                <Text style={[styles.backTodayText, { color: c.text }]}>{stage === "eve" ? t("home.live.backToDayOne") : t("home.live.backToToday")}</Text>
              </PressableScale>
            ) : null}
            <Text style={[styles.railLabel, { color: c.textMuted }]}>{data.dayDates[data.dayDates.length - 1]}</Text>
          </View>

          {liveMode ? (
            <View style={styles.dayPlan}>
              <TripItinerary trip={trip} accent={accent} day={selectedDate} now={now} place={selectedStop} />
            </View>
          ) : null}
          {liveMode ? quickActions : moneyCard}
          {liveMode ? moneyCard : quickActions}
        </View>

        <View style={styles.body}>
          {liveMode ? null : <TripItinerary trip={trip} accent={accent} now={now} />}
          <NearbyPlaces userLocation={userLocation} />
        </View>
      </Animated.ScrollView>
      <AuraTopFade />
      <LinearGradient pointerEvents="none" colors={[c.bg, `${c.bg}00`]} style={[styles.topFade, { height: insets.top + 18 }]} />
      {forecast.active ? (
        <WeatherSheet
          visible={weatherOpen}
          onClose={() => setWeatherOpen(false)}
          destinations={forecast.destinations}
          active={forecast.active}
          onSelect={forecast.select}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topFade: { position: "absolute", top: 0, left: 0, right: 0 },
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 72 },
  map: { position: "absolute", left: 0, right: 0, bottom: 0 },
  heroTop: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
  },
  greeting: { fontFamily: f.medium, fontSize: 15, flex: 1 },
  round: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: f.semibold, fontSize: 15 },
  chips: {
    paddingHorizontal: 16,
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    height: 30,
    maxWidth: "100%",
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { flexShrink: 1, fontFamily: f.medium, fontSize: 12.5 },
  passWrap: { marginTop: 16, marginBottom: 8 },
  body: { paddingHorizontal: 20 },
  railLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  railLabel: {
    fontFamily: f.medium,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  railCaption: { fontFamily: f.semibold, fontSize: 13 },
  backToday: { height: 26, paddingHorizontal: 11, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, justifyContent: "center" },
  backTodayText: { fontFamily: f.semibold, fontSize: 12 },
  dayPlan: { marginTop: 8 },
  prep: { marginBottom: 18 },
  ticketWrap: { marginTop: -2, marginBottom: 10 },
  ticketPill: { flexDirection: "row", alignItems: "center", gap: 10, height: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  ticketText: { flex: 1, fontFamily: f.semibold, fontSize: 14 },
  collapse: { position: "absolute", right: 20, bottom: 14, zIndex: 2 },
  moneyCard: {
    marginTop: 22,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  cardHighlight: {
    position: "absolute",
    top: 0,
    left: 28,
    right: 28,
    height: StyleSheet.hairlineWidth,
  },
  moneyEmpty: { flexDirection: "column", alignItems: "stretch", gap: 16 },
  emptyHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: f.semibold, fontSize: 17, letterSpacing: -0.2 },
  emptyBody: { fontFamily: f.regular, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  emptyActions: { flexDirection: "row", gap: 10 },
  moneyText: { flexShrink: 1, gap: 2 },
  moneyLabel: { fontFamily: f.medium, fontSize: 13 },
  moneyValue: { fontFamily: f.semibold, fontSize: 36, letterSpacing: -1.2 },
  chart: { flex: 1 },
  actions: { flexDirection: "row", marginTop: 26, marginHorizontal: -6 },
  sectionTitle: {
    fontFamily: f.semibold,
    fontSize: 17,
    letterSpacing: -0.2,
    marginTop: 30,
    marginBottom: 14,
  },
  legacy: { paddingHorizontal: 16, marginTop: 28, gap: 16 },
});
