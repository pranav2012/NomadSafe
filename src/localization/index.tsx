import React, { createContext, useContext, useMemo } from "react";
import * as Localization from "expo-localization";
import { I18nManager } from "react-native";
import { useSettingsStore } from "@/stores/settingsStore";
import { LANGUAGE_OPTIONS, normalizeLocale, type SupportedLocale } from "./languages";
import { translations, type TranslationResource } from "./translations.generated";

type Primitive = string | number | boolean | null | undefined;
type Params = Record<string, Primitive>;

interface LocalizationContextValue {
  locale: SupportedLocale;
  deviceLocale: SupportedLocale;
  isRTL: boolean;
  t: (key: string, params?: Params) => string;
  tArray: (key: string) => string[];
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDuration: (seconds: number) => string;
}

const fallbackLocale: SupportedLocale = "en";
const fallbackResource = translations[fallbackLocale] as TranslationResource;
const LocalizationContext = createContext<LocalizationContextValue | null>(null);

function readPath(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function interpolate(value: string, params?: Params) {
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ""));
}

export function LocalizationProvider({ children }: { children: React.ReactNode }) {
  const localeOverride = useSettingsStore((s) => s.localeOverride);
  const deviceLocale = normalizeLocale(Localization.getLocales()[0]?.languageTag);
  const locale = localeOverride ?? deviceLocale;
  const resource = translations[locale] ?? fallbackResource;
  const isRTL = locale === "ar";

  if (I18nManager.isRTL !== isRTL) {
    I18nManager.allowRTL(isRTL);
  }

  const value = useMemo<LocalizationContextValue>(() => {
    const getValue = (key: string) => readPath(resource, key) ?? readPath(fallbackResource, key);
    const formatLocale = locale;

    return {
      locale,
      deviceLocale,
      isRTL,
      t: (key, params) => {
        const valueAtKey = getValue(key);
        return typeof valueAtKey === "string" ? interpolate(valueAtKey, params) : key;
      },
      tArray: (key) => {
        const valueAtKey = getValue(key);
        return Array.isArray(valueAtKey) ? valueAtKey.filter((item) => typeof item === "string") : [];
      },
      formatDate: (value, options) =>
        new Intl.DateTimeFormat(formatLocale, { dateStyle: "medium", ...options }).format(value),
      formatTime: (value, options) =>
        new Intl.DateTimeFormat(formatLocale, { timeStyle: "short", ...options }).format(value),
      formatDateTime: (value, options) =>
        new Intl.DateTimeFormat(formatLocale, { dateStyle: "medium", timeStyle: "short", ...options }).format(value),
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
  }, [deviceLocale, isRTL, locale, resource]);

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
