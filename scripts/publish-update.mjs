// Publishes an EAS Update to a channel, then uploads its Hermes source maps to PostHog.
// Usage: node scripts/publish-update.mjs <development|preview|production> [eas update flags]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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
const hasKey = extra.some((arg) => arg.startsWith("--private-key-path"));
const PRIVATE_KEY = "keys/private-key.pem";

// Builds only accept updates signed with the key for certs/certificate.pem (docs/PLAY_RELEASE.md, step 14).
if (!hasKey && !existsSync(PRIVATE_KEY)) {
  console.error(`Missing ${PRIVATE_KEY}: restore the update signing key from its backup before publishing.`);
  process.exit(1);
}

run("npx", [
  "eas-cli",
  "update",
  "--channel",
  channel,
  "--environment",
  channel,
  ...(hasPlatform ? [] : ["--platform", "android"]),
  ...(hasMessage ? [] : ["--auto"]),
  ...(hasKey ? [] : ["--private-key-path", PRIVATE_KEY]),
  ...extra,
]);

if (!process.env.POSTHOG_CLI_API_KEY || !process.env.POSTHOG_CLI_PROJECT_ID) {
  console.warn("POSTHOG_CLI_API_KEY / POSTHOG_CLI_PROJECT_ID not set; skipping PostHog source map upload.");
  process.exit(0);
}
run("pnpm", ["exec", "posthog-cli", "hermes", "upload", "--directory", "dist"]);
