import React, { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PostHogMaskView } from "posthog-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { useTabBarInset } from "@/components/tabbar/tabBarInset";
import { useScrollActivity } from "@/hooks/useScrollActivity";
import { auraDark, auraFonts as f, auraLight, auraStatusAccent, auraStatusColors, type AuraStatus } from "@/constants/aura";
import { useGlobeContext } from "@/features/home/hooks/useGlobeContext";
import { useHotelPin, useSafetyPlaces } from "@/features/home/hooks/useTripSafety";
import type { HomeData } from "@/features/home/types";
import { TripItinerary } from "@/features/itinerary";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { NearbyPlaces } from "@/features/places/components/NearbyPlaces";
import { useTemperatureUnit, useTripForecast, toUnit } from "@/features/trips/hooks/useTripForecast";
import { describeWeather } from "@/features/trips/services/weatherService";
import { WeatherSheet } from "./WeatherSheet";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { ActionButton } from "./aura/ActionButton";
import { BoardingPass } from "./aura/BoardingPass";
import { DayRail } from "./aura/DayRail";
import { Globe } from "./aura/globe/Globe";
import { distanceKm } from "./aura/globe/sun";
import { InlineSafetyMap } from "./aura/safety/InlineSafetyMap";
import { SpendChart } from "./aura/SpendChart";

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
  onCheckIn: () => void;
  onToggleShare: () => void;
  onSos: () => void;
  onSwitchTrip: () => void;
  onOpenSettings: () => void;
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
  onCheckIn,
  onToggleShare,
  onSos,
  onSwitchTrip,
  onOpenSettings,
}: TripHomeProps) {
  const c = isDark ? auraDark : auraLight;
  const accent = auraStatusAccent[status];
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { width } = useWindowDimensions();
  const forecast = useTripForecast(trip, userLocation);
  const tempUnit = useTemperatureUnit();
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [railDay, setRailDay] = useState<number | null>(null);
  const [spendDay, setSpendDay] = useState<number | null>(null);

  const globeHeight = Math.round(width * 0.8);
  const headerSpace = insets.top + 62;
  const focusIndex = Math.min(data.stops.length - 1, Math.max(0, Math.round(data.progress * (data.stops.length - 1))));
  const focusStop = data.stops[focusIndex];
  const globe = useGlobeContext(focusStop);
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
    ? `${describeWeather(lead.weatherCode).emoji} ${toUnit(lead.tempMax, tempUnit)}° · ${t(`trip.weatherConditions.${describeWeather(lead.weatherCode).labelKey}`)}`
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
        <View style={{ height: headerSpace + globeHeight }}>
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

        <PostHogMaskView style={StyleSheet.absoluteFill}>
          {hero.mode === "globe" ? (
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
                height={headerSpace + globeHeight}
                topInset={headerSpace}
                origin={globe.origin}
                contacts={globe.contacts}
                contactColor="#3DDC97"
                accent={accent}
                isDark={isDark}
                entry={hero.entry}
                onTouchActive={setHeroTouched}
                scrolling={scrolling}
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
                accent={accent}
                isDark={isDark}
                onBackToGlobe={(center) => {
                  setHeroTouched(false);
                  setHero({ mode: "globe", entry: center });
                }}
                onTouchActive={setHeroTouched}
              />
            </Animated.View>
          )}
        </PostHogMaskView>
        {hero.mode === "globe" ? (
          <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.heroFade} />
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

        <PostHogMaskView style={styles.passWrap}>
          <BoardingPass data={data} palette={c} accent={accent} gradient={auraStatusColors[status]} isDark={isDark} emergency={emergency} scrolling={scrolling} />
        </PostHogMaskView>

        <View style={styles.body}>
          <DayRail
            totalDays={data.totalDays}
            today={data.day}
            onScrub={setRailDay}
            height={36}
            colors={{
              past: c.textSoft,
              future: isDark ? "rgba(255,255,255,0.2)" : "rgba(14,16,24,0.16)",
              today: accent,
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
            ) : null}
            <Text style={[styles.railLabel, { color: c.textMuted }]}>{data.dayDates[data.dayDates.length - 1]}</Text>
          </View>

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
        </View>

        <View style={styles.body}>
          <TripItinerary trip={trip} accent={accent} />
          <NearbyPlaces userLocation={userLocation} />
        </View>
      </Animated.ScrollView>
      <LinearGradient pointerEvents="none" colors={[c.bg, `${c.bg}00`]} style={[styles.topFade, { height: insets.top + 18 }]} />
      {forecast.active ? (
        <WeatherSheet
          visible={weatherOpen}
          onClose={() => setWeatherOpen(false)}
          destinations={forecast.destinations}
          active={forecast.active}
          unit={tempUnit}
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
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontFamily: f.medium, fontSize: 12.5 },
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
