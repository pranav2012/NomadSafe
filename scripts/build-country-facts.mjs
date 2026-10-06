#!/usr/bin/env node
/**
 * Builds src/features/trips/data/countryFacts.ts from Wikidata (CC0): emergency numbers (police,
 * ambulance, fire, general), plug types as letters, mains voltage, the main official language and
 * the currency.
 *
 *   node scripts/build-country-facts.mjs
 */
import { writeFileSync } from "node:fs";

const OUTPUT = "src/features/trips/data/countryFacts.ts";
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "NomadSafeBuild/1.0 (build script)";

// Where Wikidata lists one number for both, or leaves the ambulance unlabelled.
const OVERRIDES = {
  JP: { ambulance: "119" },
  KR: { ambulance: "119" },
  TW: { ambulance: "119" },
  AU: { general: "000" },
  NZ: { general: "111" },
  CN: { lang: "zh" },
  US: { lang: "en" },
  IN: { general: "112" },
};

// IEC plug letters from Wikidata's plug item labels.
const PLUG_LETTERS = [
  [/NEMA 1-15/i, "A"],
  [/NEMA 5-15/i, "B"],
  [/Europlug|CEE 7\/16/i, "C"],
  [/BS 546|British and related/i, "D"],
  [/Type E|CEE 7\/5/i, "E"],
  [/Schuko|CEE 7\/4/i, "F"],
  [/BS 1363/i, "G"],
  [/SI 32/i, "H"],
  [/AS\/NZS 3112|Type I/i, "I"],
  [/SEV 1011|Type J/i, "J"],
  [/107-2-D1|Type K/i, "K"],
  [/CEI 23-50|Type L/i, "L"],
  [/Type M/i, "M"],
  [/NBR 14136|IEC 60906-1|Type N/i, "N"],
];

async function sparql(query) {
  const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`Wikidata query failed (${response.status})`);
  return (await response.json()).results.bindings;
}

const NUMBERS = `SELECT ?iso ?num ?useLabel WHERE {
  ?c wdt:P297 ?iso ; p:P2852 ?st . ?st ps:P2852 ?numItem .
  OPTIONAL { ?st pq:P366 ?use }
  ?numItem rdfs:label ?num . FILTER(LANG(?num) = "en")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

const PLUGS = `SELECT ?iso (GROUP_CONCAT(DISTINCT ?plugLabel; separator="|") AS ?plugs) (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?volts) WHERE {
  ?c wdt:P297 ?iso .
  OPTIONAL { ?c wdt:P2853 ?plug . ?plug rdfs:label ?plugLabel . FILTER(LANG(?plugLabel) = "en") }
  OPTIONAL { ?c wdt:P2884 ?v }
} GROUP BY ?iso`;

const CURRENCIES = `SELECT ?iso (GROUP_CONCAT(DISTINCT ?code; separator="|") AS ?codes) WHERE {
  ?c wdt:P297 ?iso ; wdt:P38 ?cur . ?cur wdt:P498 ?code .
} GROUP BY ?iso`;

const LANGUAGES = `SELECT ?iso (GROUP_CONCAT(DISTINCT ?code; separator="|") AS ?langs) WHERE {
  ?c wdt:P297 ?iso ; wdt:P37 ?l . ?l wdt:P218 ?code .
} GROUP BY ?iso`;

function useOf(label) {
  if (!label) return "general";
  if (/police/i.test(label)) return "police";
  if (/medical|ambulance/i.test(label)) return "ambulance";
  if (/fire/i.test(label)) return "fire";
  if (/^emergency$/i.test(label)) return "general";
  return null;
}

async function main() {
  const facts = new Map();
  const entry = (iso) => {
    if (!facts.has(iso)) facts.set(iso, { police: "", ambulance: "", fire: "", general: "", plugs: "", volts: "", lang: "", currency: "" });
    return facts.get(iso);
  };

  for (const row of await sparql(NUMBERS)) {
    const use = useOf(row.useLabel?.value);
    const number = row.num.value.trim();
    if (!use || !/^[0-9]{2,5}$/.test(number)) continue;
    const country = entry(row.iso.value);
    // Shortest wins when Wikidata lists several; for the general number, the local one (999) beats 112.
    const current = country[use];
    const better = !current || number.length < current.length || (use === "general" && current === "112" && number !== "112");
    if (better) country[use] = number;
  }
  for (const row of await sparql(PLUGS)) {
    const letters = [...new Set((row.plugs?.value ?? "").split("|").flatMap((label) => PLUG_LETTERS.filter(([re]) => re.test(label)).map(([, l]) => l)))].sort();
    const country = entry(row.iso.value);
    country.plugs = letters.join("");
    // Household mains, not three-phase supply (France also lists 400 V).
    const household = (row.volts?.value ?? "").split("|").map(Number).filter((v) => v >= 90 && v <= 250);
    country.volts = household.length > 0 ? String(Math.round(Math.max(...household))) : "";
  }
  // Drivers in countries with English as an official language read English addresses.
  for (const row of await sparql(LANGUAGES)) {
    const langs = row.langs.value.split("|");
    entry(row.iso.value).lang = langs.includes("en") ? "en" : langs.sort()[0];
  }
  // Wikidata lists overseas and accepted currencies too: a national code starts with the country code
  // (JPY, INR); otherwise the euro or dollar it uses.
  for (const row of await sparql(CURRENCIES)) {
    const iso = row.iso.value;
    const codes = row.codes.value.split("|").filter((code) => /^[A-Z]{3}$/.test(code));
    entry(iso).currency = codes.find((code) => code.startsWith(iso)) ?? codes.find((code) => code === "EUR") ?? codes.find((code) => code === "USD") ?? codes[0] ?? "";
  }
  for (const [iso, override] of Object.entries(OVERRIDES)) Object.assign(entry(iso), override);

  const rows = [...facts.entries()]
    .filter(([iso, f]) => /^[A-Z]{2}$/.test(iso) && (f.police || f.ambulance || f.general || f.plugs))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, f]) => [iso, f.police, f.ambulance, f.fire, f.general, f.plugs, f.volts, f.lang, f.currency].join("|"));
  const header = [
    "// Generated by scripts/build-country-facts.mjs from Wikidata (CC0). Do not edit.",
    "// Row format: ISO|police|ambulance|fire|general emergency|plug letters|volts|main language (ISO 639-1)|currency (ISO 4217)",
  ].join("\n");
  writeFileSync(OUTPUT, `${header}\nexport const COUNTRY_FACT_ROWS = ${JSON.stringify(rows.join("\n"))};\n`);
  console.log(`Wrote ${rows.length} countries to ${OUTPUT}`);
}

await main();
