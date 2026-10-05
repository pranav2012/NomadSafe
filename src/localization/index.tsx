import React, { createContext, useContext, useEffect, useMemo } from "react";
import * as Localization from "expo-localization";
import { I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import { useSettingsStore } from "@/features/settings";
import { storage } from "@/modules/storage";
import { getEffectiveCurrency } from "@/utils/currency";
import {
  deviceUnitPrefs,
  formatApproxDuration,
  formatCompactNumber,
  formatDistance,
  formatRain,
  resolveUnitPrefs,
  toTemperature,
  uses12HourClock,
  type LabelUnit,
  type UnitPrefs,
} from "@/utils/units";
import { LANGUAGE_OPTIONS, normalizeLocale, type SupportedLocale } from "./languages";
import { translations } from "./resources";
import { fallbackResource, interpolate, lookup, readPath, type TranslateParams as Params } from "./translate";

interface LocalizationContextValue {
  locale: SupportedLocale;
  deviceLocale: SupportedLocale;
  currency: string;
  deviceCurrency: string;
  isRTL: boolean;
  t: (key: string, params?: Params) => string;
  tArray: (key: string) => string[];
  formatCurrency: (amount: number, currency?: string, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDuration: (seconds: number) => string;
  units: UnitPrefs;
  /** What "Automatic" resolves to on this phone, for Settings. */
  deviceUnits: UnitPrefs;
  deviceHour12: boolean;
  /** Pass as `hour12` to any Intl.DateTimeFormat that shows the hour. */
  hour12: boolean;
  toTemperature: (celsius: number) => number;
  /** "21°" in the user's unit. */
  formatTemperature: (celsius: number) => string;
  formatDistance: (km: number) => string;
  formatRain: (mm: number) => string;
  formatApproxDuration: (hours: number) => string;
  formatCompactNumber: (value: number) => string;
}

const LocalizationContext = createContext<LocalizationContextValue | null>(null);
const RTL_RELOAD_KEY = "nomadsafe.rtl-reload-target";
const COMPACT_THRESHOLD = 100_000;

function formatCompactCurrency(amount: number, currency: string, locale: string): string | null {
  const absAmount = Math.abs(amount);
  if (absAmount < COMPACT_THRESHOLD) return null;
  const sign = amount < 0 ? "-" : "";

  // Indian numbering system (lakhs & crores)
  if (locale === "hi" || locale === "ta" || locale === "te" || locale === "ml" || locale === "kn") {
    if (absAmount >= 1_00_00_000) {
      const crores = absAmount / 1_00_00_000;
      return `${sign}${formatCurrencyNumber(crores, locale, currency)} Cr`;
    }
    if (absAmount >= 1_00_000) {
      const lakhs = absAmount / 1_00_000;
      return `${sign}${formatCurrencyNumber(lakhs, locale, currency)} L`;
    }
  }

  // K / M / B / T for other locales
  if (absAmount >= 1_000_000_000_000) {
    return `${sign}${formatCurrencyNumber(absAmount / 1_000_000_000_000, locale, currency)}T`;
  }
  if (absAmount >= 1_000_000_000) {
    return `${sign}${formatCurrencyNumber(absAmount / 1_000_000_000, locale, currency)}B`;
  }
  if (absAmount >= 1_000_000) {
    return `${sign}${formatCurrencyNumber(absAmount / 1_000_000, locale, currency)}M`;
  }
  return `${sign}${formatCurrencyNumber(absAmount / 1_000, locale, currency)}K`;
}

function formatCurrencyNumber(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

const DATE_COMPONENTS = ["weekday", "era", "year", "month", "day", "hour", "minute", "second", "dayPeriod", "timeZoneName", "fractionalSecondDigits"] as const;

const TIME_PARTS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const DATE_PARTS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

/**
 * Intl throws if dateStyle/timeStyle are mixed with explicit components, so only default when none are
 * given. Times are spelled out as hour/minute with `hour12`: iOS Hermes ignores `hour12` with `timeStyle`.
 */
function withDefaultStyle(
  options: Intl.DateTimeFormatOptions | undefined,
  defaults: Intl.DateTimeFormatOptions,
  hour12: boolean,
): Intl.DateTimeFormatOptions {
  const merged = options && DATE_COMPONENTS.some((key) => options[key] !== undefined) ? options : { ...defaults, ...options };
  if (merged.timeStyle) {
    const spelled: Intl.DateTimeFormatOptions = { ...(merged.dateStyle ? DATE_PARTS : null), ...TIME_PARTS, ...merged, hour12 };
    delete spelled.timeStyle;
    delete spelled.dateStyle;
    return spelled;
  }
  return merged.hour ? { ...merged, hour12 } : merged;
}

/**
 * RN only applies a layout-direction change after a restart. Force the new
 * direction and reload once; the stored target stops a reload loop if the
 * platform refuses the change.
 */
function useApplyLayoutDirection(isRTL: boolean) {
  useEffect(() => {
    if (I18nManager.isRTL === isRTL) {
      storage.remove(RTL_RELOAD_KEY);
      return;
    }
    const target = isRTL ? "rtl" : "ltr";
    if (storage.getString(RTL_RELOAD_KEY) === target) return;
    storage.set(RTL_RELOAD_KEY, target);
    I18nManager.allowRTL(isRTL);
    I18nManager.forceRTL(isRTL);
    reloadAppAsync("Layout direction changed").catch(() => {});
  }, [isRTL]);
}

export function LocalizationProvider({ children }: { children: React.ReactNode }) {
  const localeOverride = useSettingsStore((s) => s.localeOverride);
  const currencyOverride = useSettingsStore((s) => s.currencyOverride);
  const unitSystem = useSettingsStore((s) => s.unitSystem);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const deviceLocalization = Localization.useLocales()[0];
  const device24h = Localization.useCalendars()[0]?.uses24hourClock;
  const deviceLocale = normalizeLocale(deviceLocalization?.languageTag);
  const locale = localeOverride ?? deviceLocale;
  const deviceCurrency = getEffectiveCurrency(null, deviceLocalization?.currencyCode);
  const currency = getEffectiveCurrency(currencyOverride, deviceLocalization?.currencyCode);
  const resource = translations[locale] ?? fallbackResource;
  const isRTL = locale === "ar";
  const measurementSystem = deviceLocalization?.measurementSystem;
  const temperatureUnit = deviceLocalization?.temperatureUnit;
  const deviceUnits = useMemo(() => deviceUnitPrefs(measurementSystem, temperatureUnit), [measurementSystem, temperatureUnit]);
  const units = useMemo(() => resolveUnitPrefs(unitSystem, deviceUnits), [unitSystem, deviceUnits]);
  const deviceHour12 = uses12HourClock(null, device24h, locale);
  const hour12 = uses12HourClock(timeFormat, device24h, locale);

  useApplyLayoutDirection(isRTL);

  const value = useMemo<LocalizationContextValue>(() => {
    const getValue = (key: string) => readPath(resource, key) ?? readPath(fallbackResource, key);
    const formatLocale = locale;
    const label: LabelUnit = (unit, amount) => {
      const valueAtKey = lookup(resource, locale, `units.${unit}`, { value: amount });
      return typeof valueAtKey === "string" ? interpolate(valueAtKey, { value: amount }) : `${amount} ${unit}`;
    };

    return {
      locale,
      deviceLocale,
      currency,
      deviceCurrency,
      isRTL,
      t: (key, params) => {
        const valueAtKey = lookup(resource, locale, key, params);
        return typeof valueAtKey === "string" ? interpolate(valueAtKey, params) : key;
      },
      tArray: (key) => {
        const valueAtKey = getValue(key);
        return Array.isArray(valueAtKey) ? valueAtKey.filter((item) => typeof item === "string") : [];
      },
      formatCurrency: (amount, selectedCurrency = currency, options) => {
        const compact = options ? null : formatCompactCurrency(amount, selectedCurrency, formatLocale);
        return compact ?? new Intl.NumberFormat(formatLocale, {
          style: "currency",
          currency: selectedCurrency,
          ...options,
        }).format(amount);
      },
      formatDate: (value, options) =>
        new Intl.DateTimeFormat(formatLocale, withDefaultStyle(options, { dateStyle: "medium" }, hour12)).format(value),
      formatTime: (value, options) =>
        new Intl.DateTimeFormat(formatLocale, withDefaultStyle(options, { timeStyle: "short" }, hour12)).format(value),
      formatDateTime: (value, options) =>
        new Intl.DateTimeFormat(
          formatLocale,
          withDefaultStyle(options, { dateStyle: "medium", timeStyle: "short" }, hour12),
        ).format(value),
      formatDuration: (seconds) => {
        try {
          return new Intl.NumberFormat(formatLocale, {
            style: "unit",
            unit: "second",
            unitDisplay: "long",
          }).format(Math.round(seconds));
        } catch {
          return `${Math.round(seconds)}s`;
        }
      },
      units,
      deviceUnits,
      deviceHour12,
      hour12,
      toTemperature: (celsius) => toTemperature(celsius, units.temperature),
      formatTemperature: (celsius) => `${toTemperature(celsius, units.temperature)}°`,
      formatDistance: (km) => formatDistance(km, units.distance, formatLocale, label),
      formatRain: (mm) => formatRain(mm, units.rain, formatLocale, label),
      formatApproxDuration: (hours) => formatApproxDuration(hours, formatLocale, label),
      formatCompactNumber: (value) => formatCompactNumber(value, formatLocale),
    };
  }, [currency, deviceCurrency, deviceHour12, deviceLocale, deviceUnits, hour12, isRTL, locale, resource, units]);

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization() {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error("useLocalization must be used within LocalizationProvider");
  return value;
}

/** The user's default currency for new trips and budgets: their pick in Settings, else the phone's. */
export function useDefaultCurrency(): string {
  return useLocalization().currency;
}

/** `useDefaultCurrency()` outside React. */
export function getDefaultCurrency(): string {
  return getEffectiveCurrency(useSettingsStore.getState().currencyOverride, Localization.getLocales()[0]?.currencyCode);
}

export { LANGUAGE_OPTIONS };
export type { SupportedLocale };
