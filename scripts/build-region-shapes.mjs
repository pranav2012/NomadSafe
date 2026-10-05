#!/usr/bin/env node
// Builds src/features/passport/data/regionShapes.ts: simplified state/province outlines for the
// passport's home pages and for working out which state a stop is in. Bundled, so lookups never
// hit a server.
//
// Also builds an India view (REGION_SHAPES_IN_VIEW) for people in India: Ladakh and Jammu and
// Kashmir drawn as India officially shows them, with those areas taken out of Pakistan and China.
//
// Sources: Natural Earth 1:10m admin-1 states and provinces, and 1:10m disputed areas (public domain).
// Usage: node scripts/build-region-shapes.mjs [admin-1.geojson] [disputed-areas.geojson]
// The India view is merged with mapshaper, fetched by npx on first run.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const SOURCE_URL = `${NE}ne_10m_admin_1_states_provinces.geojson`;
const DISPUTED_URL = `${NE}ne_10m_admin_0_disputed_areas.geojson`;
// India's official map: which state each area it claims belongs to.
const INDIA_CLAIMS = { "Aksai Chin": "IN-LA", "Shaksam Valley": "IN-LA", "Gilgit-Baltistan": "IN-LA", "Siachen Glacier": "IN-LA", "Azad Kashmir": "IN-JK" };
const CHINA_HELD = ["Aksai Chin", "Shaksam Valley"];
const PAKISTAN_HELD = ["PK-GB", "PK-JK"];
const OUT = fileURLToPath(new URL("../src/features/passport/data/regionShapes.ts", import.meta.url));
const PRECISION = 100;
// Countries whose admin-1 units are too fine to collect (départements, UK local authorities):
// group them by a coarser Natural Earth field so "12 of 18 regions" means something.
const GROUP_BY = { FR: "region", IT: "region", ES: "region", PH: "region", SI: "region", LV: "region", MT: "region", GB: "geonunit" };
const MAINLAND_GAP = 6;

async function load(path, url) {
  if (path) return JSON.parse(await readFile(path, "utf8"));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  return response.json();
}

function bounds(points) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of points) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  return [west, south, east, north];
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(sum / 2);
}

function perpendicular(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(points[i], points[first], points[last]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function encode(points) {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const push = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of points) {
    const la = Math.round(lat * PRECISION);
    const ln = Math.round(lng * PRECISION);
    push(la - prevLat);
    push(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

/** Groups features into regions per country, simplifies and encodes them; returns the TS rows. */
function buildRows(features) {
  const byCountry = new Map();
  for (const feature of features) {
    const p = feature.properties;
    const country = p.iso_a2;
    if (!country || !/^[A-Z]{2}$/.test(country) || !feature.geometry) continue;
    const groupField = GROUP_BY[country];
    const group = groupField ? p[groupField] : null;
    const key = group ? `${country}-${group}` : p.iso_3166_2 || `${country}-${p.name}`;
    const name = group || p.name_en || p.name || p.iso_3166_2 || country;
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    if (!byCountry.has(country)) byCountry.set(country, new Map());
    const regions = byCountry.get(country);
    if (!regions.has(key)) regions.set(key, { key, name, outers: [] });
    regions.get(key).outers.push(...polygons.map((polygon) => polygon[0]));
  }

  const rows = [];
  let total = 0;
  for (const country of [...byCountry.keys()].sort()) {
    const regions = [...byCountry.get(country).values()];
    const [w, s, e, n] = bounds(regions.flatMap((region) => region.outers.flat()));
    const span = Math.max(e - w, n - s);
    // Finer for small countries, coarser for big ones: about 200 units across the country.
    const tolerance = Math.min(0.02, Math.max(0.006, span / 200));
    const minArea = tolerance * tolerance * 4;
    // The mainland is the biggest group (by number of regions) of regions within GAP degrees of each
    // other; the rest (Alaska, Hawaii, French Guiana, Réunion) are kept for lookups but left off the map.
    const boxes = regions.map((region) => bounds(region.outers.flat()));
    const wraps = (box) => box[2] - box[0] > 180;
    const gap = (a, b) => (wraps(a) || wraps(b) ? Infinity : Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3])));
    let mainland = new Set();
    for (let seed = 0; seed < regions.length; seed++) {
      const cluster = new Set([seed]);
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < regions.length; i++) {
          if (cluster.has(i)) continue;
          if ([...cluster].some((j) => gap(boxes[i], boxes[j]) < MAINLAND_GAP)) {
            cluster.add(i);
            grew = true;
          }
        }
      }
      if (cluster.size > mainland.size) mainland = cluster;
    }
    const entries = regions.map((region, index) => {
      const sorted = [...region.outers].sort((a, b) => ringArea(b) - ringArea(a));
      const rings = sorted
        .filter((ring, i) => i === 0 || ringArea(ring) >= minArea)
        .map((ring) => simplify(ring, tolerance))
        .filter((ring) => ring.length >= 4);
      const points = rings.flat();
      if (points.length === 0) return null;
      const bbox = bounds(points).map((v) => Math.round(v * PRECISION) / PRECISION);
      const far = mainland.has(index) ? 0 : 1;
      total += points.length;
      return `[${JSON.stringify(region.key)},${JSON.stringify(region.name)},${JSON.stringify(bbox)},${far},${JSON.stringify(rings.map(encode).join(";"))}]`;
    });
    const kept = entries.filter(Boolean);
    if (kept.length > 0) rows.push(`  ${JSON.stringify(country)}: [\n    ${kept.join(",\n    ")},\n  ],`);
  }
  return { rows, total, countries: byCountry.size };
}

/** India, Pakistan and China as India's official map shows them, merged with mapshaper so no old border lines remain. */
function indiaView(admin1, disputed) {
  const dir = mkdtempSync(join(tmpdir(), "india-view-"));
  const file = (name, features) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));
    return path;
  };
  const mapshaper = (...args) => execFileSync("npx", ["--yes", "mapshaper@0.6", ...args], { stdio: ["ignore", "ignore", "inherit"] });
  const of = (country) => admin1.features.filter((f) => f.properties.iso_a2 === country && f.geometry);
  const named = (names) => disputed.features.filter((f) => names.includes(f.properties.BRK_NAME));

  const claims = named(Object.keys(INDIA_CLAIMS)).map((f) => {
    const key = INDIA_CLAIMS[f.properties.BRK_NAME];
    const state = of("IN").find((s) => s.properties.iso_3166_2 === key);
    return { type: "Feature", geometry: f.geometry, properties: { iso_a2: "IN", iso_3166_2: key, name: state.properties.name, name_en: state.properties.name_en } };
  });
  const india = of("IN").map((f) => ({ type: "Feature", geometry: f.geometry, properties: { iso_a2: "IN", iso_3166_2: f.properties.iso_3166_2, name: f.properties.name, name_en: f.properties.name_en } }));
  const inOut = join(dir, "india.geojson");
  mapshaper("-i", file("india-in.geojson", [...india, ...claims]), "snap", "-dissolve", "iso_3166_2", "copy-fields=iso_a2,name,name_en", "-o", inOut);

  const cnOut = join(dir, "china.geojson");
  mapshaper("-i", file("china-in.geojson", of("CN")), "snap", "-erase", file("china-held.geojson", named(CHINA_HELD)), "-o", cnOut);

  const pakistan = of("PK").filter((f) => !PAKISTAN_HELD.includes(f.properties.iso_3166_2));
  const read = (path) => JSON.parse(readFileSync(path, "utf8")).features;
  return [...read(inOut), ...read(cnOut), ...pakistan];
}

const admin1 = await load(process.argv[2], SOURCE_URL);
const disputed = await load(process.argv[3], DISPUTED_URL);
const world = buildRows(admin1.features);
const india = buildRows(indiaView(admin1, disputed));
const rows = world.rows;
const total = world.total + india.total;
const byCountry = { size: world.countries };

const file = `// Generated by scripts/build-region-shapes.mjs from Natural Earth 1:10m admin-1 states and provinces (public domain). Do not edit.
// Per country: [key, name, [west, south, east, north], far from the mainland (1/0), outer rings as 0.01° polylines joined by ";"].
export type RegionRow = [string, string, number[], number, string];
export const REGION_SHAPES: Record<string, RegionRow[]> = {
${rows.join("\n")}
};
// India's official view of India, Pakistan and China, used when the phone or home country is India.
export const REGION_SHAPES_IN_VIEW: Record<string, RegionRow[]> = {
${india.rows.join("\n")}
};
`;
await writeFile(OUT, file);
console.log(`${byCountry.size} countries, ${rows.length} rows, ${total} points, ${(file.length / 1024).toFixed(0)} KB`);
