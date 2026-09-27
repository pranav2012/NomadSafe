import React, { createContext, useContext, useEffect, useMemo } from "react";
import * as Localization from "expo-localization";
import { I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import { useSettingsStore } from "@/features/settings";
import { storage } from "@/stores/storage";
import { getEffectiveCurrency } from "@/utils/currency";
import { LANGUAGE_OPTIONS, normalizeLocale, type SupportedLocale } from "./languages";
import { translations } from "./translations.generated";
import { fallbackResource, interpolate, readPath, type TranslateParams as Params } from "./translate";

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

/** Intl throws if dateStyle/timeStyle are mixed with explicit components, so only default when none are given. */
function withDefaultStyle(
  options: Intl.DateTimeFormatOptions | undefined,
  defaults: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  if (options && DATE_COMPONENTS.some((key) => options[key] !== undefined)) return options;
  return { ...defaults, ...options };
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
  const deviceLocalization = Localization.useLocales()[0];
  const deviceLocale = normalizeLocale(deviceLocalization?.languageTag);
  const locale = localeOverride ?? deviceLocale;
  const deviceCurrency = getEffectiveCurrency(null, deviceLocalization?.currencyCode);
  const currency = getEffectiveCurrency(currencyOverride, deviceLocalization?.currencyCode);
  const resource = translations[locale] ?? fallbackResource;
  const isRTL = locale === "ar";

  useApplyLayoutDirection(isRTL);

  const value = useMemo<LocalizationContextValue>(() => {
    const getValue = (key: string) => readPath(resource, key) ?? readPath(fallbackResource, key);
    const formatLocale = locale;

    return {
      locale,
      deviceLocale,
      currency,
      deviceCurrency,
      isRTL,
      t: (key, params) => {
        const valueAtKey = getValue(key);
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
        new Intl.DateTimeFormat(formatLocale, withDefaultStyle(options, { dateStyle: "medium" })).format(value),
      formatTime: (value, options) =>
        new Intl.DateTimeFormat(formatLocale, withDefaultStyle(options, { timeStyle: "short" })).format(value),
      formatDateTime: (value, options) =>
        new Intl.DateTimeFormat(
          formatLocale,
          withDefaultStyle(options, { dateStyle: "medium", timeStyle: "short" }),
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
    };
  }, [currency, deviceCurrency, deviceLocale, isRTL, locale, resource]);

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

export { LANGUAGE_OPTIONS };
export type { SupportedLocale };
