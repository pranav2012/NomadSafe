import * as Location from "expo-location";

export interface EmergencyNumbers {
  countryCode: string;
  countryName?: string;
  general: string;
  police: string;
  ambulance: string;
}

const FALLBACK_GENERAL = "112";

/**
 * Per-country emergency numbers keyed by ISO alpha-2 code.
 * `g` general (best single number to dial), `p` police, `a` ambulance.
 * Police/ambulance default to the general number when a country uses one line.
 */
const NUMBERS: Record<string, { g: string; p?: string; a?: string }> = {
  // Europe (pan-EU 112)
  AT: { g: "112", p: "133", a: "144" },
  BE: { g: "112", p: "101", a: "112" },
  BG: { g: "112" },
  HR: { g: "112", p: "192", a: "194" },
  CY: { g: "112" },
  CZ: { g: "112", p: "158", a: "155" },
  DK: { g: "112" },
  EE: { g: "112" },
  FI: { g: "112" },
  FR: { g: "112", p: "17", a: "15" },
  DE: { g: "112", p: "110", a: "112" },
  GR: { g: "112", p: "100", a: "166" },
  HU: { g: "112", p: "107", a: "104" },
  IE: { g: "112", p: "999", a: "112" },
  IT: { g: "112", p: "113", a: "118" },
  LV: { g: "112" },
  LT: { g: "112" },
  LU: { g: "112", p: "113", a: "112" },
  MT: { g: "112" },
  NL: { g: "112" },
  PL: { g: "112", p: "997", a: "999" },
  PT: { g: "112" },
  RO: { g: "112" },
  SK: { g: "112", p: "158", a: "155" },
  SI: { g: "112", p: "113", a: "112" },
  ES: { g: "112", p: "091", a: "061" },
  SE: { g: "112" },
  GB: { g: "999", p: "999", a: "999" },
  CH: { g: "112", p: "117", a: "144" },
  NO: { g: "112", p: "112", a: "113" },
  IS: { g: "112" },
  RU: { g: "112", p: "102", a: "103" },
  UA: { g: "112", p: "102", a: "103" },
  TR: { g: "112", p: "155", a: "112" },
  RS: { g: "112", p: "192", a: "194" },
  // Americas
  US: { g: "911" },
  CA: { g: "911" },
  MX: { g: "911" },
  BR: { g: "190", p: "190", a: "192" },
  AR: { g: "911", p: "911", a: "107" },
  CL: { g: "133", p: "133", a: "131" },
  CO: { g: "123" },
  PE: { g: "105", p: "105", a: "106" },
  EC: { g: "911" },
  UY: { g: "911", p: "911", a: "105" },
  CR: { g: "911" },
  PA: { g: "911" },
  // Asia & Middle East
  IN: { g: "112", p: "100", a: "102" },
  CN: { g: "110", p: "110", a: "120" },
  JP: { g: "110", p: "110", a: "119" },
  KR: { g: "112", p: "112", a: "119" },
  TH: { g: "191", p: "191", a: "1669" },
  SG: { g: "999", p: "999", a: "995" },
  MY: { g: "999" },
  ID: { g: "112", p: "110", a: "118" },
  PH: { g: "911" },
  VN: { g: "113", p: "113", a: "115" },
  HK: { g: "999" },
  TW: { g: "110", p: "110", a: "119" },
  AE: { g: "999", p: "999", a: "998" },
  SA: { g: "911", p: "999", a: "997" },
  QA: { g: "999" },
  IL: { g: "112", p: "100", a: "101" },
  NP: { g: "112", p: "100", a: "102" },
  LK: { g: "119", p: "119", a: "1990" },
  BD: { g: "999" },
  PK: { g: "15", p: "15", a: "1122" },
  KH: { g: "117", p: "117", a: "119" },
  LA: { g: "191", p: "191", a: "195" },
  MM: { g: "199", p: "199", a: "192" },
  // Oceania
  AU: { g: "000" },
  NZ: { g: "111" },
  FJ: { g: "911", p: "917", a: "911" },
  // Africa
  ZA: { g: "112", p: "10111", a: "10177" },
  EG: { g: "122", p: "122", a: "123" },
  KE: { g: "999", p: "999", a: "112" },
  NG: { g: "112" },
  MA: { g: "19", p: "19", a: "15" },
  TZ: { g: "112", p: "112", a: "114" },
  GH: { g: "112", p: "191", a: "193" },
  ET: { g: "991", p: "991", a: "907" },
  UG: { g: "999", p: "999", a: "112" },
};

function lookup(code: string, name?: string): EmergencyNumbers {
  const entry = NUMBERS[code];
  const general = entry?.g ?? FALLBACK_GENERAL;
  return {
    countryCode: code,
    countryName: name,
    general,
    police: entry?.p ?? general,
    ambulance: entry?.a ?? general,
  };
}

/**
 * Resolves the emergency numbers for the country at the given coordinates.
 * Returns the pan-international 112 fallback when the country can't be resolved.
 */
export async function fetchEmergencyNumbers(
  coords: { latitude: number; longitude: number },
): Promise<EmergencyNumbers> {
  try {
    const [place] = await Location.reverseGeocodeAsync(coords);
    if (place?.isoCountryCode) {
      return lookup(place.isoCountryCode.toUpperCase(), place.country ?? undefined);
    }
  } catch {
    // Offline / geocoding failure — fall through to the international default.
  }
  return { countryCode: "", general: FALLBACK_GENERAL, police: FALLBACK_GENERAL, ambulance: FALLBACK_GENERAL };
}
