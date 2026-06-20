import * as Location from "expo-location";

export type AdvisoryLevel = "low" | "moderate" | "high" | "extreme";

export interface AdvisoryResult {
  countryCode: string;
  countryName?: string;
  score: number; // 0 (safest) – 5 (most dangerous)
  level: AdvisoryLevel;
}

export interface ReadinessFactors {
  hasContacts: boolean;
  locationGranted: boolean;
  timerActive: boolean;
  smsReady: boolean;
}

const ADVISORY_URL = "https://www.travel-advisory.info/api";

export function advisoryLevel(score: number): AdvisoryLevel {
  if (score < 2) return "low";
  if (score < 3.5) return "moderate";
  if (score < 4.5) return "high";
  return "extreme";
}

async function resolveCountry(
  coords: { latitude: number; longitude: number },
): Promise<{ code: string; name?: string } | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync(coords);
    if (place?.isoCountryCode) {
      return { code: place.isoCountryCode.toUpperCase(), name: place.country ?? undefined };
    }
  } catch {
    // Geocoding can fail offline; caller falls back to readiness-only score.
  }
  return null;
}

/**
 * Fetches the live travel advisory score for the country at the given coordinates.
 * Returns null when the country can't be resolved, the device is offline, or the
 * API has no advisory data — callers fall back to a readiness-only score.
 */
export async function fetchAdvisory(
  coords: { latitude: number; longitude: number },
): Promise<AdvisoryResult | null> {
  const country = await resolveCountry(coords);
  if (!country) return null;

  try {
    const res = await fetch(`${ADVISORY_URL}?countrycode=${country.code}`);
    if (!res.ok) return null;
    const json = await res.json();
    const score = json?.data?.[country.code]?.advisory?.score;
    if (typeof score !== "number") return null;
    return {
      countryCode: country.code,
      countryName: json.data[country.code]?.name ?? country.name,
      score,
      level: advisoryLevel(score),
    };
  } catch {
    return null;
  }
}

/**
 * Blends the live advisory risk (50%) with on-device safety readiness (50%).
 * When no advisory is available the score is readiness-only so it stays real.
 */
export function computeSafetyScore(
  advisory: AdvisoryResult | null,
  readiness: ReadinessFactors,
): number {
  const factors = [
    readiness.hasContacts,
    readiness.locationGranted,
    readiness.timerActive,
    readiness.smsReady,
  ];
  const readinessScore = (factors.filter(Boolean).length / factors.length) * 100;

  if (!advisory) return Math.round(readinessScore);

  const advisorySafety = (1 - advisory.score / 5) * 100;
  return Math.round(advisorySafety * 0.5 + readinessScore * 0.5);
}
