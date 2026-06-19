import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const translationsDir = path.join(root, "src", "localization", "translations");
const generatedPath = path.join(root, "src", "localization", "translations.generated.ts");
const manifestPath = path.join(translationsDir, ".source-hashes.json");
const defaultTargetLocales = ["es", "fr", "de", "pt-BR", "ja", "zh-CN", "ko", "it", "ar", "hi", "ta", "te", "ml", "kn"];

loadLocalEnv();

const apiBase = process.env.LOCALIZE_API_BASE ?? "https://cliproxy.pranav-agarwal.com/v1";
const apiKey = process.env.LOCALIZE_API_KEY ?? process.env.CLIPROXY_API_KEY;
const model = process.env.LOCALIZE_MODEL ?? "gpt-5.4-mini";
const generatedMetaKey = "__generated";
const maxAttempts = Number(process.env.LOCALIZE_MAX_ATTEMPTS ?? 4);
const targetLocales = process.env.LOCALIZE_TARGET_LOCALES
  ? process.env.LOCALIZE_TARGET_LOCALES.split(",").map((locale) => locale.trim()).filter(Boolean)
  : defaultTargetLocales;

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(root, fileName);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
      if (!match) return;

      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) return;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    });
  }
}

function flatten(value, prefix = "", out = {}) {
  if (prefix === generatedMetaKey || prefix.startsWith(`${generatedMetaKey}.`)) {
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, out));
    return out;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, out));
    return out;
  }

  out[prefix] = value;
  return out;
}

function setPath(target, key, value) {
  const parts = key.split(".");
  let current = target;

  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const nextPart = parts[index + 1];

    if (isLast) {
      current[part] = value;
      return;
    }

    current[part] ??= /^\d+$/.test(nextPart) ? [] : {};
    current = current[part];
  });
}

function inflate(flatValues) {
  const target = {};
  Object.entries(flatValues).forEach(([key, value]) => setPath(target, key, value));
  return target;
}

function sourceHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function generatedMetadata(locale, generatedAt) {
  return {
    warning: "AUTO-GENERATED FILE. Do not edit labels in this file manually.",
    locale,
    lastGeneratedAt: generatedAt,
  };
}

async function readJson(filePath, fallback = {}) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function translateBatch(locale, entries) {
  if (!apiKey) {
    throw new Error(`LOCALIZE_API_KEY or CLIPROXY_API_KEY is required to generate ${locale} translations.`);
  }

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestTranslation(locale, entries);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryableError(error)) break;

      const delayMs = 1500 * attempt;
      console.warn(`${locale}: proxy request failed, retrying ${attempt}/${maxAttempts - 1} in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

async function requestTranslation(locale, entries) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You translate mobile app UI copy naturally for the target locale. Preserve JSON keys, placeholders like {{count}}, newlines, punctuation intent, brand names, currency examples, airport/city names, and technical tokens. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({ targetLocale: locale, entries }),
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Localization proxy request failed for ${locale}: ${response.status} ${body}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  let text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Localization proxy response for ${locale} did not include JSON text.`);

  // Some model responses wrap JSON in markdown fences; strip them.
  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  return normalizeTranslations(JSON.parse(text), entries, locale);
}

function isRetryableError(error) {
  return !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
}

function normalizeTranslations(value, pendingEntries, locale) {
  const candidate = value.entries ?? value.translations ?? value.translation ?? value.result ?? value;
  const flat = flatten(candidate);
  const normalized = {};
  const missing = [];

  Object.keys(pendingEntries).forEach((key) => {
    if (typeof flat[key] === "string" && flat[key].trim()) {
      normalized[key] = flat[key];
    } else {
      missing.push(key);
    }
  });

  if (Object.keys(normalized).length === 0) {
    throw new Error(`Localization proxy returned no usable translated labels for ${locale}.`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Localization proxy response for ${locale} missed ${missing.length} labels. First missing key: ${missing[0]}`,
    );
  }

  return normalized;
}

async function updateGeneratedIndex(existingLocales) {
  const imports = [`import en from "./translations/en.json";`];
  const mapEntries = ["  en,"];

  existingLocales.forEach((locale) => {
    const variableName = locale.replace(/-/g, "_");
    imports.push(`import ${variableName} from "./translations/${locale}.json";`);
    mapEntries.push(`  "${locale}": ${variableName},`);
  });

  await writeFile(
    generatedPath,
    `${imports.join("\n")}\nimport type { SupportedLocale } from "./languages";\n\nexport type TranslationResource = typeof en;\ntype PartialTranslationResource = {\n  [Key in keyof TranslationResource]?: TranslationResource[Key] extends string[]\n    ? TranslationResource[Key]\n    : Partial<TranslationResource[Key]>;\n};\n\nexport const translations: Partial<Record<SupportedLocale, PartialTranslationResource>> = {\n${mapEntries.join("\n")}\n};\n`,
  );
}

async function main() {
  await mkdir(translationsDir, { recursive: true });
  const generatedAt = new Date().toISOString();

  const english = await readJson(path.join(translationsDir, "en.json"));
  const englishFlat = flatten(english);
  const sourceHashes = Object.fromEntries(
    Object.entries(englishFlat).map(([key, value]) => [key, sourceHash(value)]),
  );
  const manifest = await readJson(manifestPath);
  const nextManifest = { ...manifest, en: sourceHashes };
  const generatedLocales = [];

  for (const locale of targetLocales) {
    const localePath = path.join(translationsDir, `${locale}.json`);
    const existing = await readJson(localePath);
    const existingFlat = flatten(existing);
    const previousHashes = manifest[locale] ?? {};
    const pending = {};

    Object.entries(englishFlat).forEach(([key, value]) => {
      if (typeof value !== "string") {
        existingFlat[key] = value;
        return;
      }

      const hasTranslation = typeof existingFlat[key] === "string" && existingFlat[key].trim();
      const hasTrackedSource = typeof previousHashes[key] === "string";
      if (!hasTranslation || (hasTrackedSource && previousHashes[key] !== sourceHashes[key])) {
        pending[key] = value;
      }
    });

    if (Object.keys(pending).length > 0) {
      const translated = await translateBatch(locale, pending);
      Object.entries(translated).forEach(([key, value]) => {
        if (typeof value === "string") existingFlat[key] = value;
      });
    }

    Object.keys(existingFlat).forEach((key) => {
      if (!(key in englishFlat)) delete existingFlat[key];
    });

    const inflated = inflate(existingFlat);
    inflated[generatedMetaKey] = generatedMetadata(locale, generatedAt);

    await writeFile(localePath, `${JSON.stringify(inflated, null, 2)}\n`);
    nextManifest[locale] = sourceHashes;
    generatedLocales.push(locale);

    const count = Object.keys(pending).length;
    console.log(`${locale}: ${count ? `translated ${count} new/updated labels` : "no changes"}`);
  }

  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
  await updateGeneratedIndex(generatedLocales);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
