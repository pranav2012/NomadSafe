// Reports translation keys used in src/ that are missing from en.json.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const en = JSON.parse(readFileSync(path.join(root, "src/localization/translations/en.json"), "utf8"));

function get(key) {
  return key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), en);
}

function has(key) {
  return get(key) !== undefined || get(`${key}_other`) !== undefined;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const pattern = /\b(?:t|translate|tArray)\(\s*["'`]([a-zA-Z0-9_.-]+)["'`]/g;
const missing = new Map();
for (const file of walk(path.join(root, "src"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(pattern)) {
    const key = match[1];
    if (!key.includes(".") || has(key)) continue;
    const rel = path.relative(root, file);
    missing.set(key, [...(missing.get(key) ?? []), rel]);
  }
}

for (const [key, files] of [...missing].sort()) console.log(`${key}\t${[...new Set(files)].join(", ")}`);
console.log(`\n${missing.size} missing key(s)`);
process.exitCode = missing.size ? 1 : 0;
