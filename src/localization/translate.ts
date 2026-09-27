import * as Localization from "expo-localization";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { normalizeLocale, type SupportedLocale } from "./languages";
import { translations, type TranslationResource } from "./translations.generated";

export type TranslateParams = Record<string, string | number | boolean | null | undefined>;

export const fallbackResource = translations.en as TranslationResource;

export function readPath(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

export function interpolate(value: string, params?: TranslateParams) {
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ""));
}

export function getCurrentLocale(): SupportedLocale {
  const override = useSettingsStore.getState().localeOverride;
  return override ?? normalizeLocale(Localization.getLocales()[0]?.languageTag);
}

/** Non-hook translator for services, background tasks and notifications. */
export function translate(key: string, params?: TranslateParams): string {
  const resource = translations[getCurrentLocale()] ?? fallbackResource;
  const value = readPath(resource, key) ?? readPath(fallbackResource, key);
  return typeof value === "string" ? interpolate(value, params) : key;
}
