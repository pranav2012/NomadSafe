import { useEffect, useState } from "react";
import * as Localization from "expo-localization";
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

export type TemperatureUnit = "C" | "F";

/** Device temperature preference; Open-Meteo data is always Celsius. */
export function useTemperatureUnit(): TemperatureUnit {
  const deviceLocale = Localization.useLocales()[0];
  if (deviceLocale?.temperatureUnit) return deviceLocale.temperatureUnit === "fahrenheit" ? "F" : "C";
  return deviceLocale?.measurementSystem === "us" ? "F" : "C";
}

export function toUnit(celsius: number, unit: TemperatureUnit) {
  return unit === "F" ? Math.round((celsius * 9) / 5 + 32) : celsius;
}

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

/** Summarises rain across the forecast into a short headline and sub line. */
export function buildOutlook(days: DailyForecast[], locale: string, t: ReturnType<typeof useLocalization>["t"]) {
  const probs = days.map((d) => d.precipProbability).filter((p): p is number => p != null);
  if (!probs.length) return null;
  const maxProb = Math.max(...probs);
  const rainy = days.filter((d) => d.precipProbability != null && d.precipProbability >= 50);
  if (rainy.length) {
    const first = weekday(rainy[0].date, locale);
    const last = weekday(rainy[rainy.length - 1].date, locale);
    return {
      title: t("trip.weatherOutlookRain"),
      subtitle: t("trip.weatherRainDays", { days: first === last ? first : `${first}–${last}`, prob: maxProb }),
    };
  }
  if (maxProb >= 20) return { title: t("trip.weatherOutlookShowers"), subtitle: t("trip.weatherShowersSub", { prob: maxProb }) };
  return { title: t("trip.weatherOutlookDry"), subtitle: t("trip.weatherDrySub") };
}

/**
 * Daily forecasts for each trip destination within Open-Meteo's window. The default destination
 * is the one nearest the user; `select` switches it.
 */
export function useTripForecast(trip: Trip, userLocation: { latitude?: number; longitude?: number } | null) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const { startDate, endDate, destinations } = trip;
  const destinationsKey = destinations.join("|");
  const coordinates = getDestinationCoordinates(trip);
  const coordsKey = coordinates.map((c) => (c ? `${c.latitude},${c.longitude}` : "-")).join("|");

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
          const coords = coordinates[index] ?? (await geocodeDestination(name));
          if (!coords) return null;
          const days = await getDailyForecast(coords, window.start, window.end);
          return days?.length ? { name, index, coords, days } : null;
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
  let defaultName: string | null = ready[0]?.name ?? null;
  if (ready.length && userLocation?.latitude != null && userLocation.longitude != null) {
    const here = { latitude: userLocation.latitude, longitude: userLocation.longitude };
    defaultName = ready.reduce((best, d) => (distanceKm(here, d.coords) < distanceKm(here, best.coords) ? d : best)).name;
  }
  const activeName = selectedName && ready.some((d) => d.name === selectedName) ? selectedName : defaultName;
  const active = ready.find((d) => d.name === activeName) ?? ready[0] ?? null;

  return { status: state.status, destinations: ready, active, select: setSelectedName };
}
