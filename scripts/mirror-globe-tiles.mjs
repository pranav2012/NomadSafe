#!/usr/bin/env node
// One-time copy of the NASA GIBS tiles the home globe uses (levels 3–7 of the EPSG:4326 "500m" set,
// Blue Marble day + Black Marble night, ~34k tiles, ~3 GB) into a local folder laid out as
// <layer>/<z>/<row>/<col>.<ext>, ready to upload to a public Cloudflare R2 bucket:
//
//   node scripts/mirror-globe-tiles.mjs [outDir=.globe-tiles]
//   rclone copy .globe-tiles r2:<bucket> --transfers 32 --header-upload "Cache-Control: public, max-age=31536000, immutable"
//
// Then set EXPO_PUBLIC_GLOBE_TILES_URL to the bucket's custom domain (r2.dev URLs are rate limited).
// Safe to stop and re-run: tiles already on disk are skipped.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Buffer } from "node:buffer";

const OUT = process.argv[2] ?? ".globe-tiles";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";
const LAYERS = [
  { name: "day", ext: "jpeg", url: (z, r, c) => `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/500m/${z}/${r}/${c}.jpeg` },
  { name: "night", ext: "png", url: (z, r, c) => `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/500m/${z}/${r}/${c}.png` },
];
const LEVELS = [3, 4, 5, 6, 7];
const PARALLEL = 10;

function* jobs() {
  for (const layer of LAYERS) {
    for (const z of LEVELS) {
      const span = 288 / 2 ** z;
      for (let r = 0; r < Math.round(180 / span); r += 1) {
        for (let c = 0; c < Math.round(360 / span); c += 1) {
          yield { path: join(OUT, layer.name, `${z}`, `${r}`, `${c}.${layer.ext}`), url: layer.url(z, r, c) };
        }
      }
    }
  }
}

async function download({ path, url }) {
  if (existsSync(path)) return "skipped";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "NomadSafe tile mirror" } });
      if (response.ok && (response.headers.get("content-type") ?? "").startsWith("image/")) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, Buffer.from(await response.arrayBuffer()));
        return "saved";
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  return "failed";
}

const all = [...jobs()];
const counts = { saved: 0, skipped: 0, failed: 0 };
let next = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (next < all.length) {
      const job = all[next++];
      counts[await download(job)] += 1;
      const done = counts.saved + counts.skipped + counts.failed;
      if (done % 500 === 0) console.log(`${done}/${all.length}`, counts);
    }
  }),
);
console.log("done", counts);
if (counts.failed) {
  console.log("Some tiles failed; run the script again to retry them.");
  process.exitCode = 1;
}
