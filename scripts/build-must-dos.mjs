#!/usr/bin/env node
/**
 * Builds src/features/itinerary/data/mustDos.ts: the best-known sights around the top destinations in
 * src/features/trips/data/cities.ts, from Wikidata (CC0, no attribution needed).
 *
 *   node scripts/build-must-dos.mjs [count=400]
 *
 * "Best known" = number of Wikipedia language editions with an article (sitelinks). Each city's answer
 * is cached in node_modules/.cache/nomadsafe-must-dos, so a rerun only queries what's missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT = "src/features/itinerary/data/mustDos.ts";
const CACHE = "node_modules/.cache/nomadsafe-must-dos";
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "NomadSafeBuild/1.0 (build script; contact via github.com/pranav)";
const COUNT = Number(process.argv[2] ?? 400);
// Queried and cached per city; the output keeps the top SHIPPED.
const PER_CITY = 8;
const SHIPPED = 6;
const WORKERS = 3;
// Latin-script languages read the English name fine, so only these get their own names.
const SHIPPED_LANGUAGES = new Set(["ar", "hi", "ja", "kn", "ko", "ml", "ta", "te", "zh"]);
const MIN_SITELINKS = 12;
// Curated places are regions or islands, so they search wider than a city.
const CITY_RADIUS_KM = 15;
const REGION_RADIUS_KM = 40;
const DENSE_RADIUS_KM = 6;

// Broad classes; subclasses match too (a Shinto shrine is a religious building).
const TYPES = {
  Q570116: "a", // tourist attraction
  Q33506: "a", // museum
  Q22698: "a", // park
  Q24398318: "a", // religious building
  Q23413: "a", // castle
  Q16560: "a", // palace
  Q4989906: "a", // monument
  Q174782: "a", // square
  Q12280: "a", // bridge
  Q12518: "a", // tower
  Q1107656: "a", // garden
  Q43501: "a", // zoo
  Q2281788: "a", // aquarium
  Q839954: "a", // archaeological site
  Q57821: "a", // fortification
  Q2319498: "a", // landmark
  Q40080: "a", // beach
  Q34038: "a", // waterfall
  Q37654: "f", // marketplace
};

// App languages to Wikidata label codes, in order of preference.
const LANGUAGES = {
  ar: ["ar"],
  de: ["de"],
  es: ["es"],
  fr: ["fr"],
  hi: ["hi"],
  it: ["it"],
  ja: ["ja"],
  kn: ["kn"],
  ko: ["ko"],
  ml: ["ml"],
  pt: ["pt-br", "pt"],
  ta: ["ta"],
  te: ["te"],
  zh: ["zh-cn", "zh-hans", "zh"],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => value.replace(/[|\n;:]/g, " ").replace(/\s+/g, " ").trim();
const round = (value) => Math.round(value * 1000) / 1000;

async function sparql(query) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    }).catch(() => null);
    if (response?.ok) return (await response.json()).results.bindings;
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error("Wikidata query kept failing");
}

function sightsQuery(lat, lon, radius) {
  return `SELECT ?item ?label ?loc (MAX(?sl) AS ?links) (SAMPLE(?type) AS ?kind) WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral; wikibase:radius "${radius}". }
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= ${MIN_SITELINKS})
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q15661340 }
  VALUES ?type { ${Object.keys(TYPES).map((id) => `wd:${id}`).join(" ")} }
  ?item wdt:P31/wdt:P279* ?type .
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
} GROUP BY ?item ?label ?loc ORDER BY DESC(?links) LIMIT ${PER_CITY * 2}`;
}

function labelsQuery(ids) {
  const codes = Object.values(LANGUAGES).flat();
  return `SELECT ?item ?label WHERE {
  VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
  ?item rdfs:label ?label . FILTER(LANG(?label) IN (${codes.map((code) => `"${code}"`).join(", ")}))
}`;
}

async function sightsFor(city, index) {
  const file = join(CACHE, `${index}-${city.name.replace(/\W+/g, "_")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));

  const radius = city.region ? REGION_RADIUS_KM : CITY_RADIUS_KM;
  // Dense cities (Paris) time out at full radius; their centre alone has plenty of sights.
  const rows = await sparql(sightsQuery(city.lat, city.lon, radius)).catch(() => sparql(sightsQuery(city.lat, city.lon, DENSE_RADIUS_KM)));
  const seen = new Set();
  const sights = [];
  for (const row of rows) {
    const id = row.item.value.split("/").pop();
    const name = clean(row.label.value);
    const [lon, lat] = row.loc.value.replace(/^Point\(|\)$/g, "").split(" ").map(Number);
    if (seen.has(name.toLowerCase()) || Number.isNaN(lat)) continue;
    seen.add(name.toLowerCase());
    sights.push({ id, name, lat: round(lat), lon: round(lon), kind: TYPES[row.kind.value.split("/").pop()] ?? "a", labels: {} });
    if (sights.length === PER_CITY) break;
  }
  if (sights.length > 0) {
    await sleep(500);
    for (const row of await sparql(labelsQuery(sights.map((sight) => sight.id)))) {
      const sight = sights.find((entry) => entry.id === row.item.value.split("/").pop());
      const code = row.label["xml:lang"];
      const app = Object.entries(LANGUAGES).find(([, codes]) => codes.includes(code));
      if (!sight || !app) continue;
      const [lang, codes] = app;
      const current = sight.labels[lang];
      // Keep the most preferred variant (zh-cn over zh).
      if (!current || codes.indexOf(code) < codes.indexOf(current.code)) sight.labels[lang] = { code, value: clean(row.label.value) };
    }
  }
  writeFileSync(file, JSON.stringify(sights));
  return sights;
}

// Things Wikidata files under a matched class that aren't sights: stock exchanges ("markets"), schools.
const EXCLUDED_CLASSES = ["Q11691", "Q2385804", "Q1244442"];

/** Ids among `ids` that are instances of an excluded class, checked in batches. */
async function excludedIds(ids) {
  const excluded = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    const batch = ids.slice(i, i + 300);
    const rows = await sparql(`SELECT DISTINCT ?item WHERE {
  VALUES ?item { ${batch.map((id) => `wd:${id}`).join(" ")} }
  VALUES ?bad { ${EXCLUDED_CLASSES.map((id) => `wd:${id}`).join(" ")} }
  ?item wdt:P31/wdt:P279* ?bad .
}`);
    for (const row of rows) excluded.add(row.item.value.split("/").pop());
    await sleep(500);
  }
  return excluded;
}

function readCities() {
  const source = readFileSync("src/features/trips/data/cities.ts", "utf8");
  const rows = JSON.parse(source.match(/export const CITY_ROWS = ("(?:[^"\\]|\\.)*")/)[1]);
  return rows
    .split("\n")
    .slice(0, COUNT)
    .map((line) => {
      const [name, , country, lat, lon, flag] = line.split("|");
      return { name, country, lat: Number(lat), lon: Number(lon), region: flag === "p" };
    });
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const cities = readCities();
  // A few queries at a time; the query service allows up to five per client.
  const results = new Array(cities.length);
  const skipped = [];
  let nextIndex = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (nextIndex < cities.length) {
        const index = nextIndex++;
        // A city whose query keeps timing out is left out (and not cached, so a rerun tries again).
        results[index] = await sightsFor(cities[index], index).catch(() => {
          skipped.push(cities[index].name);
          return [];
        });
        done += 1;
        process.stdout.write(`\r${done}/${cities.length} ${cities[index].name.padEnd(30)}`);
        await sleep(500);
      }
    }),
  );
  const excluded = await excludedIds([...new Set(results.flat().map((sight) => sight.id))]);
  const lines = [];
  let total = 0;
  for (const [index, city] of cities.entries()) {
    const sights = results[index].filter((sight) => !excluded.has(sight.id));
    if (sights.length === 0) continue;
    lines.push(`#${city.name}|${city.country}|${city.lat}|${city.lon}|${city.region ? REGION_RADIUS_KM : CITY_RADIUS_KM}`);
    for (const sight of sights.slice(0, SHIPPED)) {
      const labels = Object.entries(sight.labels)
        .filter(([lang, label]) => SHIPPED_LANGUAGES.has(lang) && label.value !== sight.name)
        .map(([lang, label]) => `${lang}:${label.value}`)
        .join(";");
      lines.push(`${sight.name}|${sight.lat}|${sight.lon}|${sight.kind}${labels ? `|${labels}` : ""}`);
      total += 1;
    }
  }
  const header = [
    "// Generated by scripts/build-must-dos.mjs from Wikidata (CC0). Do not edit.",
    "// The best-known sights around top destinations, ranked by how many Wikipedia editions cover them.",
    "// Rows: #city|country|lat|lon|radius km, then sight|lat|lon|a (sight) or f (food market)[|lang:name;…]",
  ].join("\n");
  writeFileSync(OUTPUT, `${header}\nexport const MUST_DO_ROWS = ${JSON.stringify(lines.join("\n"))};\n`);
  if (skipped.length > 0) console.log(`\nSkipped after repeated failures: ${skipped.join(", ")}`);
  console.log(`\nWrote ${total} sights for ${lines.filter((line) => line.startsWith("#")).length} places to ${OUTPUT}`);
}

await main();
