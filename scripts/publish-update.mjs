// Publishes an EAS Update to a channel, then uploads its source maps to Sentry.
// Usage: node scripts/publish-update.mjs <development|preview|production> [eas update flags]
import { spawnSync } from "node:child_process";

const CHANNELS = ["development", "preview", "production"];
const [channel, ...extra] = process.argv.slice(2);

if (!CHANNELS.includes(channel)) {
  console.error(`Channel must be one of: ${CHANNELS.join(", ")}`);
  process.exit(1);
}

function run(cmd, args) {
  const { status } = spawnSync(cmd, args, { stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
}

// Android-only until iOS ships; pass -p/--platform to override.
const hasPlatform = extra.some((arg) => arg === "-p" || arg.startsWith("--platform"));
const hasMessage = extra.some((arg) => arg === "-m" || arg.startsWith("--message") || arg === "--auto");

run("npx", [
  "eas-cli",
  "update",
  "--channel",
  channel,
  "--environment",
  channel,
  ...(hasPlatform ? [] : ["--platform", "android"]),
  ...(hasMessage ? [] : ["--auto"]),
  ...extra,
]);

if (!process.env.SENTRY_AUTH_TOKEN) {
  console.warn("SENTRY_AUTH_TOKEN not set; skipping Sentry source map upload.");
  process.exit(0);
}
run("npx", ["sentry-expo-upload-sourcemaps", "dist"]);
