import { storage } from "@/stores/storage";
import { resolveCountry } from "./countryResolver";
import { FCDO_SLUGS } from "./fcdoCountrySlugs";

export type FcdoLevel =
  | "none"
  | "avoidAllButEssentialParts"
  | "avoidAllParts"
  | "avoidAllButEssentialWhole"
  | "avoidAllWhole";

export interface AdvisoryResult {
  countryCode: string;
  countryName: string;
  slug: string;
  level: FcdoLevel;
  updatedAt: string | null;
  changeDescription: string | null;
  webUrl: string;
  fetchedAt: number;
  /** True when this is a saved copy because the live refresh failed. */
  stale: boolean;
}

export type AdvisoryUnavailableReason = "noCountry" | "notCovered" | "unreachable";

export type AdvisoryLookup =
  | { kind: "ok"; advisory: AdvisoryResult }
  | { kind: "unavailable"; reason: AdvisoryUnavailableReason; countryName?: string };

interface IndexEntry {
  slug: string;
  name: string;
  synonyms: string[];
}

interface CachedIndex {
  fetchedAt: number;
  entries: IndexEntry[];
}

type CachedAdvice = Omit<AdvisoryResult, "countryCode" | "stale">;

const API_BASE = "https://www.gov.uk/api/content/foreign-travel-advice";
const INDEX_KEY = "safety.fcdo-index";
const ADVICE_KEY_PREFIX = "safety.fcdo-advice.";
const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ADVICE_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

const LEVEL_ORDER: FcdoLevel[] = [
  "none",
  "avoidAllButEssentialParts",
  "avoidAllParts",
  "avoidAllButEssentialWhole",
  "avoidAllWhole",
];

const STATUS_LEVEL: Record<string, FcdoLevel> = {
  avoid_all_but_essential_travel_to_parts: "avoidAllButEssentialParts",
  avoid_all_travel_to_parts: "avoidAllParts",
  avoid_all_but_essential_travel_to_whole_country: "avoidAllButEssentialWhole",
  avoid_all_travel_to_whole_country: "avoidAllWhole",
};

const LEVEL_SAFETY: Record<FcdoLevel, number> = {
  none: 100,
  avoidAllButEssentialParts: 70,
  avoidAllParts: 50,
  avoidAllButEssentialWhole: 20,
  avoidAllWhole: 0,
};

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readJson<T>(key: string): T | null {
  const raw = storage.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]/g, "");
}

export function levelFromStatuses(statuses: unknown): FcdoLevel {
  if (!Array.isArray(statuses)) return "none";
  let worst = 0;
  for (const status of statuses) {
    const level = typeof status === "string" ? STATUS_LEVEL[status] : undefined;
    if (level) worst = Math.max(worst, LEVEL_ORDER.indexOf(level));
  }
  return LEVEL_ORDER[worst];
}

function parseIndex(json: unknown): IndexEntry[] {
  const children = asRecord(asRecord(json)?.links)?.children;
  if (!Array.isArray(children)) return [];
  const entries: IndexEntry[] = [];
  for (const child of children) {
    const country = asRecord(asRecord(asRecord(child)?.details)?.country);
    const slug = asString(country?.slug);
    const name = asString(country?.name);
    if (!slug || !name) continue;
    const synonyms = Array.isArray(country?.synonyms)
      ? country.synonyms.filter((s): s is string => typeof s === "string")
      : [];
    entries.push({ slug, name, synonyms });
  }
  return entries;
}

/** Country index, cached for 7 days; a stale copy is used when offline. */
async function getIndex(forceRefresh = false): Promise<IndexEntry[] | null> {
  const cached = readJson<CachedIndex>(INDEX_KEY);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < INDEX_TTL_MS) return cached.entries;
  try {
    const entries = parseIndex(await fetchJson(API_BASE));
    if (entries.length > 0) {
      storage.set(INDEX_KEY, JSON.stringify({ fetchedAt: Date.now(), entries } satisfies CachedIndex));
      return entries;
    }
  } catch {}
  return cached?.entries ?? null;
}

function matchIndexByName(entries: IndexEntry[], name: string | undefined): IndexEntry | null {
  if (!name) return null;
  const target = normalizeName(name);
  return (
    entries.find((e) => normalizeName(e.name) === target) ??
    entries.find((e) => e.synonyms.some((s) => normalizeName(s) === target)) ??
    null
  );
}

/**
 * Maps a country to its GOV.UK slug: the bundled ISO table first (works
 * offline), then the live index by country name for anything it misses.
 */
async function resolveSlug(code: string, name: string | undefined): Promise<string | null> {
  const known = FCDO_SLUGS[code];
  if (known) return known;
  const index = await getIndex();
  return index ? matchIndexByName(index, name)?.slug ?? null : null;
}

function parseAdvice(json: unknown, slug: string): CachedAdvice | null {
  const root = asRecord(json);
  const details = asRecord(root?.details);
  if (!root || !details) return null;
  const country = asRecord(details.country);
  const basePath = asString(root.base_path) ?? `/foreign-travel-advice/${slug}`;
  return {
    slug,
    countryName: asString(country?.name) ?? slug,
    level: levelFromStatuses(details.alert_status),
    updatedAt: asString(root.public_updated_at) ?? asString(details.updated_at),
    changeDescription: asString(details.change_description),
    webUrl: asString(root.web_url) ?? `https://www.gov.uk${basePath}`,
    fetchedAt: Date.now(),
  };
}

async function fetchAdvice(slug: string, countryName: string | undefined): Promise<CachedAdvice | null> {
  try {
    return parseAdvice(await fetchJson(`${API_BASE}/${slug}`), slug);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) return null;
  }
  // Slug was renamed upstream: refresh the index and retry once by country name.
  const index = await getIndex(true);
  const renamed = index ? matchIndexByName(index, countryName) : null;
  if (!renamed || renamed.slug === slug) return null;
  try {
    return parseAdvice(await fetchJson(`${API_BASE}/${renamed.slug}`), renamed.slug);
  } catch {
    return null;
  }
}

/**
 * UK FCDO travel advice for the country at the given coordinates. Live advice
 * is cached for 12 h; when a refresh fails the last good copy is returned
 * with `stale: true`. Never throws.
 */
export async function fetchAdvisory(
  coords: { latitude: number; longitude: number },
): Promise<AdvisoryLookup> {
  const country = await resolveCountry(coords);
  if (!country) return { kind: "unavailable", reason: "noCountry" };

  const slug = await resolveSlug(country.code, country.name);
  if (!slug) return { kind: "unavailable", reason: "notCovered", countryName: country.name };

  const key = `${ADVICE_KEY_PREFIX}${slug}`;
  const cached = readJson<CachedAdvice>(key);
  if (cached && Date.now() - cached.fetchedAt < ADVICE_TTL_MS) {
    return { kind: "ok", advisory: { ...cached, countryCode: country.code, stale: false } };
  }

  const fresh = await fetchAdvice(slug, country.name);
  if (fresh) {
    storage.set(key, JSON.stringify(fresh));
    return { kind: "ok", advisory: { ...fresh, countryCode: country.code, stale: false } };
  }
  if (cached) return { kind: "ok", advisory: { ...cached, countryCode: country.code, stale: true } };
  return { kind: "unavailable", reason: "unreachable", countryName: country.name };
}

/**
 * Blends FCDO advice (50%) with on-device readiness (50%, `readinessRatio`
 * 0–1). Without advice the score is readiness-only so it stays honest.
 */
export function computeSafetyScore(advisory: AdvisoryResult | null, readinessRatio: number): number {
  const readinessScore = Math.max(0, Math.min(1, readinessRatio)) * 100;
  if (!advisory) return Math.round(readinessScore);
  return Math.round(LEVEL_SAFETY[advisory.level] * 0.5 + readinessScore * 0.5);
}
