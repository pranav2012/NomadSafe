export const SUPPORTED_LOCALES = [
  "en",
  "es",
  "fr",
  "de",
  "pt-BR",
  "ja",
  "zh-CN",
  "ko",
  "it",
  "ar",
  "hi",
  "ta",
  "te",
  "ml",
  "kn",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LANGUAGE_OPTIONS: { locale: SupportedLocale; label: string; nativeLabel: string }[] = [
  { locale: "en", label: "English", nativeLabel: "English" },
  { locale: "es", label: "Spanish", nativeLabel: "Español" },
  { locale: "fr", label: "French", nativeLabel: "Français" },
  { locale: "de", label: "German", nativeLabel: "Deutsch" },
  { locale: "pt-BR", label: "Portuguese (Brazil)", nativeLabel: "Português (Brasil)" },
  { locale: "ja", label: "Japanese", nativeLabel: "日本語" },
  { locale: "zh-CN", label: "Simplified Chinese", nativeLabel: "简体中文" },
  { locale: "ko", label: "Korean", nativeLabel: "한국어" },
  { locale: "it", label: "Italian", nativeLabel: "Italiano" },
  { locale: "ar", label: "Arabic", nativeLabel: "العربية" },
  { locale: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { locale: "ta", label: "Tamil", nativeLabel: "தமிழ்" },
  { locale: "te", label: "Telugu", nativeLabel: "తెలుగు" },
  { locale: "ml", label: "Malayalam", nativeLabel: "മലയാളം" },
  { locale: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ" },
];

export function normalizeLocale(languageTag?: string | null): SupportedLocale {
  if (!languageTag) return "en";

  const tag = languageTag.replace("_", "-").toLowerCase();
  if (tag === "pt-br" || tag.startsWith("pt-br-")) return "pt-BR";
  if (tag === "zh-cn" || tag.startsWith("zh-hans") || tag.startsWith("zh-cn-")) return "zh-CN";

  const base = tag.split("-")[0];
  const match = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === base);
  return match ?? "en";
}
