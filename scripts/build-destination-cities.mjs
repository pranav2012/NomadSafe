#!/usr/bin/env node
/**
 * Builds src/features/trips/data/cities.ts from GeoNames cities15000 (CC BY 4.0).
 *
 *   node scripts/build-destination-cities.mjs [path/to/cities15000.txt]
 *   GOOGLE_PLACES_API_KEY=... node scripts/build-destination-cities.mjs --verify
 *
 * Without a path it downloads the dump (needs curl + unzip). `--verify` checks POPULAR_PLACES
 * against Google Places Text Search and writes nothing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUTPUT = "src/features/trips/data/cities.ts";

// A place is a destination when it is a capital, or big enough and known abroad.
const MIN_POPULATION = 100_000;
const ALWAYS_KEEP_POPULATION = 1_000_000;
// Names in other languages; a proxy for how well known a place is (Venice 66, Bao'an 2).
const MIN_FOREIGN_NAMES = 10;
// Suburbs: within this distance of a city at least SUBURB_RATIO times bigger in the same country.
const SUBURB_DISTANCE_KM = 20;
const SUBURB_RATIO = 3;
const SUBURB_KEEP_FOREIGN_NAMES = 30;
const NOTABILITY_WEIGHT = 0.8;

// Neighbourhoods, historical and abandoned places.
const SKIPPED_FEATURE_CODES = new Set(["PPLX", "PPLH", "PPLQ", "PPLW"]);
const NAME_OVERRIDES = { "New York City": "New York", Brugge: "Bruges", Luzern: "Lucerne" };
const ALIASES = {
  Bengaluru: ["bangalore"],
  Mumbai: ["bombay"],
  Chennai: ["madras"],
  Kolkata: ["calcutta"],
  Panjim: ["panaji"],
  Bruges: ["brugge"],
  Lucerne: ["luzern"],
};
// Smaller places worth having offline (GeoNames name or ASCII name + country), kept regardless of filters.
const EXTRA_CITIES = [
  "Venice|IT", "Siena|IT", "Pisa|IT", "Dubrovnik|HR", "Split|HR", "Salzburg|AT", "Innsbruck|AT", "Luzern|CH",
  "Cannes|FR", "Sintra|PT", "Faro|PT", "Chefchaouen|MA", "Essaouira|MA", "Hoi An|VN", "Luang Prabang|LA",
  "Ubud|ID", "Phuket|TH", "Krabi|TH", "Galle|LK", "Rishikesh|IN", "Manali|IN", "Leh|IN", "Shimla|IN",
  "Panjim|IN", "Rotorua|NZ", "Ushuaia|AR", "Tulum|MX", "Playa del Carmen|MX", "Antigua Guatemala|GT",
  "Key West|US", "Napa|US", "Takayama|JP", "Nadi|FJ", "Ronda|ES", "Cusco|PE", "Siem Reap|KH", "Pushkar|IN",
];
// Regions, islands and small towns GeoNames lacks or filters out, listed first.
// name|alternate names (;)|ISO country|lat|lon; coordinates match Google (checked with --verify, 2026-10-05).
const POPULAR_PLACES = [
  "Bali||ID|-8.41|115.19", "Lombok||ID|-8.65|116.32", "Goa||IN|15.3|74.12", "Kerala||IN|10.16|76.64",
  "Rajasthan||IN|27.02|74.22", "Ladakh||IN|34.15|77.58", "Santorini|thira|GR|36.39|25.46", "Mykonos||GR|37.45|25.33",
  "Crete||GR|35.24|24.81", "Hawaii||US|19.9|-155.67", "Maui||US|20.8|-156.33", "Ibiza||ES|38.98|1.43",
  "Mallorca|majorca|ES|39.7|2.99", "Tenerife||ES|28.29|-16.63", "Canary Islands||ES|28.29|-16.63",
  "Andalusia|andalucia|ES|37.54|-4.73", "Sicily||IT|37.4|14.66", "Sardinia||IT|40.12|9.01", "Tuscany||IT|43.46|11.14",
  "Amalfi Coast|amalfi|IT|40.63|14.6", "Lake Como|como|IT|46.02|9.26", "Cinque Terre||IT|44.13|9.71",
  "Dolomites||IT|46.41|11.84", "Provence||FR|44.01|6.21", "Normandy||FR|48.88|0.17",
  "French Riviera|cote d'azur|FR|43.25|6.64", "Algarve||PT|37.26|-8.4", "Madeira||PT|32.65|-16.91",
  "Azores||PT|37.74|-25.68", "Bavaria||DE|48.13|11.57", "Scottish Highlands|highlands|GB|57.36|-5.1",
  "Cotswolds||GB|51.83|-1.83", "Lapland||FI|67.92|26.5", "Cappadocia||TR|38.64|34.83", "Zanzibar||TZ|-6.17|39.2",
  "Tasmania||AU|-42|146.6", "Byron Bay||AU|-28.64|153.61", "Okinawa||JP|26.21|127.68", "Hokkaido||JP|43.22|142.86",
  "Jeju Island|jeju|KR|33.5|126.53", "Bora Bora||PF|-16.5|-151.74", "Galápagos Islands|galapagos|EC|-0.38|-90.42",
  "Yucatán|yucatan|MX|20.71|-89.09", "Patagonia||AR|-41.81|-68.91", "Langkawi||MY|6.35|99.8",
  "Koh Samui|ko samui;samui|TH|9.51|100.01", "Boracay||PH|11.97|121.92", "Palawan||PH|9.95|119.11",
  "Ha Long Bay|halong bay;halong|VN|20.91|107.18", "Sapa|sa pa|VN|22.34|103.84", "Banff||CA|51.18|-115.57",
  "Zermatt||CH|46.02|7.75", "Interlaken||CH|46.69|7.86", "Hallstatt||AT|47.56|13.65",
  "Queenstown||NZ|-45.03|168.66", "Kotor||ME|42.42|18.77",
];
// The build fails if any of these goes missing (output name|country).
const MUST_HAVE = [
  "Paris|FR", "London|GB", "New York|US", "Tokyo|JP", "Kyoto|JP", "Lisbon|PT", "Rome|IT", "Venice|IT",
  "Florence|IT", "Barcelona|ES", "Berlin|DE", "Amsterdam|NL", "Istanbul|TR", "Dubai|AE", "Singapore|SG",
  "Bangkok|TH", "Bengaluru|IN", "Mumbai|IN", "Delhi|IN", "Sydney|AU", "Cape Town|ZA", "Mexico City|MX",
  "Rio de Janeiro|BR", "Reykjavík|IS", "Brooklyn|US", "San Diego|US", "Bern|CH", "London|CA",
];
// ISO 3166-1 regions offered as destinations; English names are the fallback when Intl.DisplayNames is missing.
const COUNTRY_CODES = [
  "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ", "BS", "BH",
  "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR", "IO", "BN", "BG", "BF",
  "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC", "CO", "KM", "CG", "CD", "CK", "CR",
  "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO", "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET",
  "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF", "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP",
  "GU", "GT", "GG", "GN", "GW", "GY", "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE",
  "IM", "IL", "IT", "JM", "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "KW", "KG", "LA", "LV", "LB", "LS",
  "LR", "LY", "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
  "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI", "NE", "NG",
  "NU", "NF", "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PN", "PL", "PT", "PR",
  "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC", "WS", "SM", "ST", "SA", "SN", "RS",
  "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS", "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH",
  "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO", "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE",
  "GB", "US", "UM", "UY", "UZ", "VU", "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW",
];

const fold = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const placeKey = (name, country) => `${fold(name)}|${country}`;
const parsePlace = (row) => {
  const [name, alternates, country, lat, lon] = row.split("|");
  return { name, alternates, country, latitude: Number(lat), longitude: Number(lon) };
};

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/** Reports curated places whose coordinates are far from Google's (Text Search, location only). */
async function verifyPopularPlaces() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Set GOOGLE_PLACES_API_KEY to verify");
  const englishNames = new Intl.DisplayNames(["en"], { type: "region" });
  let off = 0;
  for (const row of POPULAR_PLACES) {
    const place = parsePlace(row);
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: `${place.name}, ${englishNames.of(place.country)}`, pageSize: 1 }),
    });
    const google = (await response.json()).places?.[0];
    if (!google?.location) {
      console.log(`?  ${place.name}: no Google result`);
      continue;
    }
    const km = distanceKm(place, google.location);
    if (km > 25) off += 1;
    console.log(
      `${km > 25 ? "!!" : "ok"} ${place.name} (${google.formattedAddress}): ${km.toFixed(0)} km off, Google ${google.location.latitude.toFixed(2)}|${google.location.longitude.toFixed(2)}`,
    );
  }
  console.log(`${off} of ${POPULAR_PLACES.length} curated places are more than 25 km from Google's location.`);
}

function sourcePath() {
  const path = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (path) return path;
  const dir = mkdtempSync(join(tmpdir(), "geonames-"));
  const zip = join(dir, "cities15000.zip");
  execFileSync("curl", ["-sSL", "-o", zip, "https://download.geonames.org/export/dump/cities15000.zip"], { stdio: "inherit" });
  execFileSync("unzip", ["-q", zip, "-d", dir], { stdio: "inherit" });
  return join(dir, "cities15000.txt");
}

function build() {
  const source = sourcePath();
  const extras = new Set(EXTRA_CITIES.map((entry) => placeKey(...entry.split("|"))));
  const foundExtras = new Set();
  const stats = { unknown: 0, suburbs: 0, duplicates: 0 };

  const places = readFileSync(source, "utf8")
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length > 14 && !SKIPPED_FEATURE_CODES.has(cols[7]))
    .map((cols) => {
      const geoName = cols[1].replace(/-shi$/, "");
      const extraKey = [placeKey(cols[1], cols[8]), placeKey(cols[2], cols[8])].find((key) => extras.has(key));
      if (extraKey) foundExtras.add(extraKey);
      return {
        name: NAME_OVERRIDES[geoName] ?? geoName,
        ascii: cols[2].replace(/-shi$/, ""),
        country: cols[8],
        latitude: Number(cols[4]),
        longitude: Number(cols[5]),
        population: Number(cols[14]),
        foreignNames: cols[3] ? cols[3].split(",").length : 0,
        capital: cols[7] === "PPLC",
        extra: Boolean(extraKey),
      };
    });

  const candidates = places
    .filter((place) => {
      const known =
        place.capital ||
        place.extra ||
        place.population >= ALWAYS_KEEP_POPULATION ||
        (place.population >= MIN_POPULATION && place.foreignNames >= MIN_FOREIGN_NAMES);
      if (!known && place.population >= MIN_POPULATION) stats.unknown += 1;
      return known;
    })
    .sort((a, b) => b.population - a.population);

  const kept = [];
  for (const place of candidates) {
    const protectedPlace = place.capital || place.extra || place.foreignNames >= SUBURB_KEEP_FOREIGN_NAMES;
    const suburb =
      !protectedPlace &&
      kept.some(
        (bigger) =>
          bigger.country === place.country &&
          bigger.population >= SUBURB_RATIO * place.population &&
          distanceKm(bigger, place) < SUBURB_DISTANCE_KM,
      );
    if (suburb) stats.suburbs += 1;
    else kept.push(place);
  }

  const notability = (place) => Math.log10(Math.max(place.population, 1)) + NOTABILITY_WEIGHT * Math.log10(1 + place.foreignNames);
  kept.sort((a, b) => notability(b) - notability(a));

  const seen = new Set();
  const lines = POPULAR_PLACES.map((row) => {
    const place = parsePlace(row);
    seen.add(placeKey(place.name, place.country));
    return `${row}|p`;
  });
  for (const place of kept) {
    const key = placeKey(place.name, place.country);
    if (seen.has(key) || /[|;\n]/.test(place.name)) {
      stats.duplicates += 1;
      continue;
    }
    seen.add(key);
    const alternates = new Set([fold(place.ascii), ...(ALIASES[place.name] ?? [])]);
    alternates.delete(fold(place.name));
    lines.push([place.name, [...alternates].join(";"), place.country, +place.latitude.toFixed(2), +place.longitude.toFixed(2)].join("|"));
  }

  const missingExtras = [...extras].filter((key) => !foundExtras.has(key));
  if (missingExtras.length) console.warn(`EXTRA_CITIES not found in GeoNames: ${missingExtras.join(", ")}`);
  const missing = MUST_HAVE.filter((entry) => !seen.has(placeKey(...entry.split("|"))));
  if (missing.length) {
    console.error(`Missing must-have destinations: ${missing.join(", ")}. Adjust the filters or EXTRA_CITIES.`);
    process.exit(1);
  }

  const englishNames = new Intl.DisplayNames(["en"], { type: "region" });
  const countryRows = COUNTRY_CODES.map((code) => `${code}|${englishNames.of(code)}`).join("\n");
  const sourceDate = statSync(source).mtime.toISOString().slice(0, 10);
  writeFileSync(
    OUTPUT,
    `// Generated by scripts/build-destination-cities.mjs from the GeoNames cities15000 dump of ${sourceDate}. Do not edit.
// City data © GeoNames (geonames.org), CC BY 4.0. Curated popular places first, then cities by population and
// how widely they are known.
// Row format: name|alternate names (;)|ISO country|lat|lon[|p for a curated popular place]
export const CITY_ROWS = ${JSON.stringify(lines.join("\n"))};
// Row format: ISO country|English name
export const COUNTRY_ROWS = ${JSON.stringify(countryRows)};
`,
  );

  const byCountry = {};
  for (const place of kept) byCountry[place.country] = (byCountry[place.country] ?? 0) + 1;
  const top = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, count]) => `${code} ${count}`);
  console.log(
    [
      `GeoNames rows: ${places.length}`,
      `Dropped as little known: ${stats.unknown}, as suburbs: ${stats.suburbs}, as duplicates: ${stats.duplicates}`,
      `Wrote ${lines.length} places (${POPULAR_PLACES.length} curated) to ${OUTPUT}`,
      `Most per country: ${top.join(", ")}`,
    ].join("\n"),
  );
}

if (process.argv.includes("--verify")) await verifyPopularPlaces();
else build();
