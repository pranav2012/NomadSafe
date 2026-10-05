#!/usr/bin/env node
// Builds src/features/recap/data/countryShapes.ts: simplified country outlines for the trip recap map
// and share card, keyed by ISO 3166-1 alpha-2 (the codes in features/trips/data/cities.ts).
//
// Also builds an India view (COUNTRY_SHAPES_IN_VIEW) of India, Pakistan and China for people in
// India, from Natural Earth's India point-of-view countries.
//
// Sources: Natural Earth 1:50m admin-0 countries and 1:10m India point-of-view countries (public domain).
// Usage: node scripts/build-country-shapes.mjs [ne_50m_admin_0_countries.geojson] [ne_10m_admin_0_countries_ind.geojson]
// Without a path it downloads the file from the natural-earth-vector repository.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
const OUT = fileURLToPath(new URL("../src/features/recap/data/countryShapes.ts", import.meta.url));
// Degrees. 0.02° is about 2 km, finer than a stroke at the zoom levels the recap shows.
const TOLERANCE = 0.02;
// Islands smaller than this (square degrees) are dropped unless they are all a country has.
const MIN_RING_AREA = 0.004;
const PRECISION = 100;

const INDIA_VIEW_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson";
const INDIA_VIEW_CODES = ["IN", "PK", "CN"];

async function loadSource(path = process.argv[2], url = SOURCE_URL) {
  if (path) return JSON.parse(await readFile(path, "utf8"));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  return response.json();
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

/** Douglas–Peucker, iterative so long coastlines can't overflow the stack. */
function simplify(points) {
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
    if (max > TOLERANCE) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Google's polyline encoding at 0.01°, as [lat, lng] pairs. */
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

/** Simplified, encoded outlines per country code; several features can share a code (e.g. Australia's small external territories), so the biggest wins. */
function buildShapes(features, codes = null) {
  const shapes = {};
  for (const feature of features) {
    const code = feature.properties.ISO_A2_EH;
    if (!code || code === "-99" || !feature.geometry || (codes && !codes.includes(code))) continue;
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const outers = polygons.map((polygon) => polygon[0]).sort((a, b) => ringArea(b) - ringArea(a));
    const rings = outers
      .filter((ring, i) => i === 0 || ringArea(ring) >= MIN_RING_AREA)
      .map(simplify)
      .filter((ring) => ring.length >= 4);
    if (rings.length === 0) continue;
    const area = outers.reduce((sum, ring) => sum + ringArea(ring), 0);
    if (shapes[code] && shapes[code].area >= area) continue;
    const all = rings.flat();
    const bbox = [
      all.reduce((m, p) => Math.min(m, p[0]), Infinity),
      all.reduce((m, p) => Math.min(m, p[1]), Infinity),
      all.reduce((m, p) => Math.max(m, p[0]), -Infinity),
      all.reduce((m, p) => Math.max(m, p[1]), -Infinity),
    ].map((v) => Math.round(v * PRECISION) / PRECISION);
    shapes[code] = { bbox, area, continent: feature.properties.CONTINENT, rings: rings.map(encode), points: rings.reduce((sum, ring) => sum + ring.length, 0) };
  }
  return shapes;
}

const shapes = buildShapes((await loadSource()).features);
const indiaView = buildShapes((await loadSource(process.argv[3], INDIA_VIEW_URL)).features, INDIA_VIEW_CODES);
let total = 0;
for (const shape of Object.values(shapes)) total += shape.points;
const rowsOf = (set) =>
  Object.keys(set)
    .sort()
    .map((code) => `  ${code}: [${JSON.stringify(set[code].bbox)}, ${JSON.stringify(set[code].rings.join(";"))}, ${JSON.stringify(set[code].continent)}],`);
const rows = rowsOf(shapes);
const file = `// Generated by scripts/build-country-shapes.mjs from Natural Earth 1:50m admin-0 countries (public domain). Do not edit.
// Each entry: [west, south, east, north] bounds, outer rings as 0.01° polylines joined by ";", continent.
export const COUNTRY_SHAPES: Record<string, [number[], string, string]> = {
${rows.join("\n")}
};
// India's official view of India, Pakistan and China, used when the phone or home country is India.
export const COUNTRY_SHAPES_IN_VIEW: Record<string, [number[], string, string]> = {
${rowsOf(indiaView).join("\n")}
};
`;
await writeFile(OUT, file);
console.log(`${Object.keys(shapes).length} countries, ${total} points, ${(file.length / 1024).toFixed(0)} KB`);
