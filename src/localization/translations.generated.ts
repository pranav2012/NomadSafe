import en from "./translations/en.json";
import es from "./translations/es.json";
import fr from "./translations/fr.json";
import de from "./translations/de.json";
import pt_BR from "./translations/pt-BR.json";
import ja from "./translations/ja.json";
import zh_CN from "./translations/zh-CN.json";
import ko from "./translations/ko.json";
import it from "./translations/it.json";
import ar from "./translations/ar.json";
import hi from "./translations/hi.json";
import ta from "./translations/ta.json";
import te from "./translations/te.json";
import ml from "./translations/ml.json";
import kn from "./translations/kn.json";
import type { SupportedLocale } from "./languages";

export type TranslationResource = typeof en;

export const translations: Partial<Record<SupportedLocale, TranslationResource>> = {
  en,
  "es": es,
  "fr": fr,
  "de": de,
  "pt-BR": pt_BR,
  "ja": ja,
  "zh-CN": zh_CN,
  "ko": ko,
  "it": it,
  "ar": ar,
  "hi": hi,
  "ta": ta,
  "te": te,
  "ml": ml,
  "kn": kn,
};
