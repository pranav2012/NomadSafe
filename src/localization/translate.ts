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

/**
 * Resolves a key with plural variants: when `params.count` is a number, tries
 * `key_<category>` (Intl.PluralRules: one, few, many, other…), then `key_other`,
 * then the bare key, in the given resource and the English fallback.
 */
export function lookup(
  resource: unknown,
  locale: string,
  key: string,
  params?: TranslateParams,
): unknown {
  const count = params?.count;
  const candidates = [key];
  if (typeof count === "number") {
    let category = "other";
    try {
      category = new Intl.PluralRules(locale).select(count);
    } catch {}
    candidates.unshift(`${key}_${category}`, `${key}_other`);
  }
  // Prefer any translated form over the English fallback.
  for (const source of [resource, fallbackResource]) {
    for (const candidate of candidates) {
      const value = readPath(source, candidate);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

export function getCurrentLocale(): SupportedLocale {
  const override = useSettingsStore.getState().localeOverride;
  return override ?? normalizeLocale(Localization.getLocales()[0]?.languageTag);
}

/** Non-hook translator for services, background tasks and notifications. */
export function translate(key: string, params?: TranslateParams): string {
  const locale = getCurrentLocale();
  const resource = translations[locale] ?? fallbackResource;
  const value = lookup(resource, locale, key, params);
  return typeof value === "string" ? interpolate(value, params) : key;
}
