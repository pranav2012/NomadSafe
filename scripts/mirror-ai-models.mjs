#!/usr/bin/env node
// Copies the on-device AI models (AI_MODELS in src/modules/ai/local/modelCatalog.ts) from Hugging Face into
// a local folder laid out as <revision>/<file>.gguf, checks each file's size and sha256, and is then uploaded
// to the public Cloudflare R2 models bucket:
//
//   node scripts/mirror-ai-models.mjs [outDir=.ai-models]
//   rclone copy .ai-models r2:<models-bucket> --transfers 2 --s3-chunk-size 64M --header-upload "Cache-Control: public, max-age=31536000, immutable"
//
// Then set EXPO_PUBLIC_AI_MODELS_URL to the bucket's custom domain (r2.dev URLs are rate limited).
// Re-run after adding or changing a model; verified files already on disk are skipped.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { buildSync } from "esbuild";

const OUT = process.argv[2] ?? ".ai-models";

function loadCatalog() {
  const { outputFiles } = buildSync({
    entryPoints: ["src/modules/ai/local/modelCatalog.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", outputFiles[0].text)(module, module.exports, () => ({}));
  return module.exports;
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function verified(path, model) {
  return existsSync(path) && statSync(path).size === model.sizeBytes && (await sha256(path)) === model.sha256;
}

const { AI_MODELS, modelUrl } = loadCatalog();
let failed = 0;
for (const model of AI_MODELS) {
  const dir = join(OUT, model.revision);
  const path = join(dir, model.hfFilename);
  if (await verified(path, model)) {
    console.log(`${model.id}: already mirrored`);
    continue;
  }
  const url = modelUrl(model, null);
  console.log(`${model.id}: downloading ${url}`);
  mkdirSync(dir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    console.log(`${model.id}: HTTP ${response.status}`);
    failed += 1;
    continue;
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.part`));
  renameSync(`${path}.part`, path);
  if (await verified(path, model)) {
    console.log(`${model.id}: ok`);
  } else {
    console.log(`${model.id}: size or sha256 mismatch; not safe to upload`);
    failed += 1;
  }
}
if (failed) process.exitCode = 1;
