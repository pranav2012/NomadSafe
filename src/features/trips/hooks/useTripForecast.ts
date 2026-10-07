import { useEffect, useEffectEvent, useState } from "react";
import { useLocalization } from "@/localization";
import { geocodeDestination } from "@/features/trips/services/geocoding";
import { getDestinationCoordinates, type LatLng, type Trip } from "@/features/trips/store/tripsStore";
import { clampToForecastWindow, getDailyForecast, type DailyForecast } from "@/features/trips/services/weatherService";

export interface DestinationForecast {
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

export function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}

export function weekday(dateKey: string, locale: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(year, month - 1, day));
}

function distanceKm(a: LatLng, b: LatLng) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.latitude - a.latitude) / 2) ** 2 +
    Math.sin(toRad(b.longitude - a.longitude) / 2) ** 2 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// A day with at least SHOWER_MM reads as showers; RAIN_MM or more as a rainy day.
const SHOWER_MM = 1;
const RAIN_MM = 5;

/** Rain amount to show under a day's icon, or null for a dry day. */
export function dayRain(day: DailyForecast, formatRain: (mm: number) => string) {
  return day.precipMm != null && day.precipMm >= SHOWER_MM ? formatRain(day.precipMm) : null;
}

/** Summarises rain across the forecast into a short headline and sub line. */
export function buildOutlook(days: DailyForecast[], { locale, t, formatRain }: ReturnType<typeof useLocalization>) {
  const amounts = days.map((d) => d.precipMm).filter((mm): mm is number => mm != null);
  if (!amounts.length) return null;
  const amount = formatRain(Math.max(...amounts));
  const rainy = days.filter((d) => d.precipMm != null && d.precipMm >= RAIN_MM);
  if (rainy.length) {
    const first = weekday(rainy[0].date, locale);
    const last = weekday(rainy[rainy.length - 1].date, locale);
    return {
      title: t("trip.weatherOutlookRain"),
      subtitle: t("trip.weatherRainDays", { days: first === last ? first : `${first}–${last}`, amount }),
    };
  }
  if (Math.max(...amounts) >= SHOWER_MM) return { title: t("trip.weatherOutlookShowers"), subtitle: t("trip.weatherShowersSub", { amount }) };
  return { title: t("trip.weatherOutlookDry"), subtitle: t("trip.weatherDrySub") };
}

/**
 * Daily forecasts for each trip destination within the forecast window. The default destination
 * is the one nearest the user; `select` switches it.
 */
export function useTripForecast(trip: Trip, userLocation: { latitude?: number; longitude?: number } | null) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const { startDate, endDate, destinations } = trip;
  const destinationsKey = destinations.join("|");
  const coordinates = getDestinationCoordinates(trip);
  const coordsKey = coordinates.map((c) => (c ? `${c.latitude},${c.longitude}` : "-")).join("|");
  const requestKey = `${startDate}|${endDate}|${destinationsKey}|${coordsKey}`;
  const forecastWindow = clampToForecastWindow(startDate, endDate);
  const [loaded, setLoaded] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = !forecastWindow ? { status: "outside" } : loaded?.key === requestKey ? loaded.state : { status: "loading" };

  // Reads the latest destinations and coordinates; reruns only when the request key changes.
  const fetchForecasts = useEffectEvent(async (): Promise<LoadState> => {
    if (!forecastWindow) return { status: "outside" };
    const results = await Promise.all(
      destinations.map(async (name, index): Promise<DestinationForecast | null> => {
        const coords = coordinates[index] ?? (await geocodeDestination(name));
        if (!coords) return null;
        const days = await getDailyForecast(coords, forecastWindow.start, forecastWindow.end);
        return days?.length ? { name, index, coords, days } : null;
      }),
    );
    const ready = results.filter((r): r is DestinationForecast => r !== null);
    return ready.length ? { status: "ready", destinations: ready } : { status: "unavailable" };
  });

  useEffect(() => {
    let cancelled = false;
    void fetchForecasts().then((result) => {
      if (!cancelled) setLoaded({ key: requestKey, state: result });
    });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const ready = state.status === "ready" ? state.destinations : [];
  let defaultName: string | null = ready[0]?.name ?? null;
  if (ready.length && userLocation?.latitude != null && userLocation.longitude != null) {
    const here = { latitude: userLocation.latitude, longitude: userLocation.longitude };
    defaultName = ready.reduce((best, d) => (distanceKm(here, d.coords) < distanceKm(here, best.coords) ? d : best)).name;
  }
  const activeName = selectedName && ready.some((d) => d.name === selectedName) ? selectedName : defaultName;
  const active = ready.find((d) => d.name === activeName) ?? ready[0] ?? null;

  return { status: state.status, destinations: ready, active, select: setSelectedName };
}
