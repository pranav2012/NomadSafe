import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { geocodeDestination } from "@/features/trips/services/geocoding";
import type { LatLng, Trip } from "@/features/trips/store/tripsStore";
import {
  clampToForecastWindow,
  describeWeather,
  getDailyForecast,
  type DailyForecast,
} from "@/features/trips/services/weatherService";

type ThemeColors = ReturnType<typeof useTheme>["nomad"]["colors"];
type Translate = ReturnType<typeof useLocalization>["t"];

interface DestinationForecast {
  name: string;
  index: number;
  coords: LatLng;
  days: DailyForecast[];
}

type LoadState =
  | { status: "loading" }
  | { status: "outside" }
  | { status: "unavailable" }
  | { status: "ready"; destinations: DestinationForecast[] };

interface UserLocation {
  latitude?: number;
  longitude?: number;
}

const MAX_STRIP_DAYS = 6;

function todayKey() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function weekday(dateKey: string, locale: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
    new Date(year, month - 1, day),
  );
}

function distanceKm(a: LatLng, b: LatLng) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Picks the destination nearest the user's GPS position, falling back to the
 * trip's current destination and then the first available one. */
function defaultDestinationName(
  destinations: DestinationForecast[],
  userLocation: UserLocation | null,
  currentIndex: number,
): string {
  if (userLocation?.latitude != null && userLocation.longitude != null) {
    const here: LatLng = {
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
    };
    let nearest = destinations[0];
    let best = Infinity;
    for (const destination of destinations) {
      const d = distanceKm(here, destination.coords);
      if (d < best) {
        best = d;
        nearest = destination;
      }
    }
    return nearest.name;
  }

  return destinations.find((d) => d.index === currentIndex)?.name ?? destinations[0].name;
}

interface Outlook {
  title: string;
  subtitle: string;
}

/** Builds the gold headline + sub line summarizing rain across the forecast. */
function buildOutlook(days: DailyForecast[], locale: string, t: Translate): Outlook | null {
  const probs = days
    .map((d) => d.precipProbability)
    .filter((p): p is number => p != null);
  if (!probs.length) return null;

  const maxProb = Math.max(...probs);
  const rainy = days.filter((d) => d.precipProbability != null && d.precipProbability >= 50);

  if (rainy.length) {
    const first = weekday(rainy[0].date, locale);
    const last = weekday(rainy[rainy.length - 1].date, locale);
    return {
      title: t("trip.weatherOutlookRain"),
      subtitle: t("trip.weatherRainDays", {
        days: first === last ? first : `${first}–${last}`,
        prob: maxProb,
      }),
    };
  }

  if (maxProb >= 20) {
    return {
      title: t("trip.weatherOutlookShowers"),
      subtitle: t("trip.weatherShowersSub", { prob: maxProb }),
    };
  }

  return { title: t("trip.weatherOutlookDry"), subtitle: t("trip.weatherDrySub") };
}

export function TripWeather({
  trip,
  userLocation,
  currentIndex,
}: {
  trip: Trip;
  userLocation: UserLocation | null;
  currentIndex: number;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { startDate, endDate, destinations } = trip;
  const destinationsKey = destinations.join("|");
  const coordsKey = (trip.destinationCoordinates ?? [])
    .map((c) => `${c.latitude},${c.longitude}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const window = clampToForecastWindow(startDate, endDate);
      if (!window) {
        if (!cancelled) setState({ status: "outside" });
        return;
      }

      if (!cancelled) setState({ status: "loading" });

      const results = await Promise.all(
        destinations.map(async (name, index): Promise<DestinationForecast | null> => {
          const coords =
            trip.destinationCoordinates?.[index] ?? (await geocodeDestination(name));
          if (!coords) return null;
          const days = await getDailyForecast(coords, window.start, window.end);
          if (!days?.length) return null;
          return { name, index, coords, days };
        }),
      );

      if (cancelled) return;

      const ready = results.filter((r): r is DestinationForecast => r !== null);
      setState(ready.length ? { status: "ready", destinations: ready } : { status: "unavailable" });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, destinationsKey, coordsKey]);

  const ready = state.status === "ready" ? state.destinations : [];
  const defaultName = ready.length
    ? defaultDestinationName(ready, userLocation, currentIndex)
    : null;
  const activeName =
    selectedName && ready.some((d) => d.name === selectedName) ? selectedName : defaultName;
  const active = ready.find((d) => d.name === activeName) ?? ready[0];
  const hasPicker = ready.length > 1;

  const handleSelect = (name: string) => {
    setSelectedName(name);
    setPickerOpen(false);
  };

  return (
    <View style={styles.container}>
      <Pressable
        disabled={!hasPicker || state.status !== "ready"}
        onPress={() => setPickerOpen((open) => !open)}
        style={styles.header}
      >
        <Text style={[styles.eyebrow, { color: theme.inkMuted }]} numberOfLines={1}>
          {t("trip.weatherTitle")}
          {active ? <Text style={{ color: theme.inkSoft }}>{`  ·  ${active.name}`}</Text> : null}
        </Text>
        {hasPicker && state.status === "ready" ? (
          <Icon name="chevronDown" size={14} color={theme.inkMuted} />
        ) : null}
      </Pressable>

      <View style={[styles.panel, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
        {state.status === "loading" ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={theme.teal} />
            <Text style={[styles.statusText, { color: theme.inkSoft }]}>
              {t("trip.weatherLoading")}
            </Text>
          </View>
        ) : null}

        {state.status === "outside" ? (
          <Text style={[styles.statusText, { color: theme.inkSoft }]}>
            {t("trip.weatherOutsideWindow")}
          </Text>
        ) : null}

        {state.status === "unavailable" ? (
          <Text style={[styles.statusText, { color: theme.inkSoft }]}>
            {t("trip.weatherUnavailable")}
          </Text>
        ) : null}

        {state.status === "ready" && active ? (
          pickerOpen && hasPicker ? (
            <View style={styles.options}>
              {ready.map((destination) => {
                const selected = destination.name === active.name;
                return (
                  <Pressable
                    key={destination.name}
                    onPress={() => handleSelect(destination.name)}
                    style={({ pressed }) => [styles.option, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text
                      style={[styles.optionText, { color: selected ? theme.teal : theme.inkSoft }]}
                      numberOfLines={1}
                    >
                      {destination.name}
                    </Text>
                    {selected ? <Icon name="check" size={15} color={theme.teal} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <WeatherBody days={active.days} theme={theme} locale={locale} t={t} />
          )
        ) : null}
      </View>
    </View>
  );
}

function WeatherBody({
  days,
  theme,
  locale,
  t,
}: {
  days: DailyForecast[];
  theme: ThemeColors;
  locale: string;
  t: Translate;
}) {
  const lead = days[0];
  const condition = describeWeather(lead.weatherCode);
  const outlook = buildOutlook(days, locale, t);
  const strip = days.slice(0, MAX_STRIP_DAYS);
  const today = todayKey();

  return (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroEmoji}>{condition.emoji}</Text>
        <View style={styles.heroMain}>
          <Text style={[styles.heroTemp, { color: theme.inkDeep }]}>
            {`${lead.tempMax}°`}
            <Text style={[styles.heroUnit, { color: theme.inkMuted }]}>C</Text>
          </Text>
          <Text style={[styles.heroMeta, { color: theme.inkSoft }]} numberOfLines={1}>
            {`${t(`trip.weatherConditions.${condition.labelKey}`)} · ${t("trip.weatherFeelsLike", {
              temp: lead.feelsLike,
            })} · ${t("trip.weatherUv", { value: lead.uvIndex })}`}
          </Text>
        </View>
        {outlook ? (
          <View style={styles.outlook}>
            <Text style={[styles.outlookTitle, { color: theme.mustard }]} numberOfLines={1}>
              {outlook.title}
            </Text>
            <Text style={[styles.outlookSub, { color: theme.inkSoft }]} numberOfLines={1}>
              {outlook.subtitle}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.divider, { borderColor: theme.hairline }]} />

      <View style={styles.strip}>
        {strip.map((day) => {
          const dayCondition = describeWeather(day.weatherCode);
          return (
            <View key={day.date} style={styles.dayCol}>
              <Text style={[styles.dayLabel, { color: theme.inkMuted }]} numberOfLines={1}>
                {day.date === today ? t("trip.weatherToday") : weekday(day.date, locale)}
              </Text>
              <Text style={styles.dayEmoji}>{dayCondition.emoji}</Text>
              <Text style={[styles.dayTemp, { color: theme.inkDeep }]}>{`${day.tempMax}°`}</Text>
            </View>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  eyebrow: {
    flex: 1,
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  panel: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusText: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  heroEmoji: {
    fontSize: 34,
  },
  heroMain: {
    flex: 1,
  },
  heroTemp: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 42,
    lineHeight: 46,
  },
  heroUnit: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 18,
  },
  heroMeta: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12.5,
    marginTop: 2,
  },
  outlook: {
    alignItems: "flex-end",
    maxWidth: "38%",
  },
  outlookTitle: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  outlookSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11.5,
    marginTop: 2,
    textAlign: "right",
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    marginVertical: 14,
  },
  strip: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayCol: {
    alignItems: "center",
    flex: 1,
    gap: 6,
  },
  dayLabel: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  dayEmoji: {
    fontSize: 20,
  },
  dayTemp: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
  options: {
    gap: 2,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    paddingHorizontal: 4,
  },
  optionText: {
    fontFamily: NOMAD_FONTS.uiMedium,
    fontSize: 14,
    flexShrink: 1,
  },
});
