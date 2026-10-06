import { COUNTRY_FACT_ROWS } from "@/features/trips/data/countryFacts";

export type EmergencyKind = "police" | "ambulance" | "fire" | "general";

export interface CountryFacts {
  police: string | null;
  ambulance: string | null;
  fire: string | null;
  general: string | null;
  /** IEC plug letters, e.g. "AB". */
  plugs: string;
  volts: number | null;
  /** Main language (ISO 639-1) used for local addresses. */
  language: string | null;
  /** ISO 4217 code of the money used there. */
  currency: string | null;
}

export interface EmergencyTile {
  kinds: EmergencyKind[];
  number: string;
}

let byCountry: Map<string, CountryFacts> | null = null;

function parse() {
  const map = new Map<string, CountryFacts>();
  for (const line of COUNTRY_FACT_ROWS.split("\n")) {
    const [iso, police, ambulance, fire, general, plugs, volts, language, currency] = line.split("|");
    map.set(iso, {
      police: police || null,
      ambulance: ambulance || null,
      fire: fire || null,
      general: general || null,
      plugs: plugs ?? "",
      volts: volts ? Number(volts) : null,
      language: language || null,
      currency: currency || null,
    });
  }
  return map;
}

export function countryFacts(iso: string | null | undefined): CountryFacts | null {
  if (!iso) return null;
  byCountry ??= parse();
  return byCountry.get(iso.toUpperCase()) ?? null;
}

/**
 * Up to three numbers to dial: police, ambulance and fire, merging kinds that share a number
 * (Japan's 119 is ambulance and fire); the general number (112, 999) fills in for any that's missing.
 */
export function emergencyTiles(facts: CountryFacts): EmergencyTile[] {
  const tiles: EmergencyTile[] = [];
  for (const kind of ["police", "ambulance", "fire"] as const) {
    const number = facts[kind];
    if (!number) continue;
    const same = tiles.find((tile) => tile.number === number);
    if (same) same.kinds.push(kind);
    else tiles.push({ kinds: [kind], number });
  }
  const covered = tiles.flatMap((tile) => tile.kinds);
  if (facts.general && !tiles.some((tile) => tile.number === facts.general) && covered.length < 3) {
    tiles.unshift({ kinds: ["general"], number: facts.general });
  }
  return tiles.slice(0, 3);
}

/** How many units of a currency to quote so the converted amount reads well: ¥100 ≈ ₹56, not ¥1 ≈ ₹0.56. */
export function quoteUnits(rate: number): number {
  let units = 1;
  while (rate * units < 10 && units < 1_000_000) units *= 10;
  return units;
}

/** True when none of the destination's plug types fit the home country's sockets' plugs. */
export function needsAdapter(home: CountryFacts | null, destination: CountryFacts | null): boolean | null {
  if (!home?.plugs || !destination?.plugs) return null;
  return ![...destination.plugs].some((letter) => home.plugs.includes(letter));
}
