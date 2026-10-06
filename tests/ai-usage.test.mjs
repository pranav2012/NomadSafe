import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const rules = loadModule("convex/billingRules.ts");
const policy = loadModule("src/modules/ai/policy.ts");
const log = loadModule("src/modules/ai/usageLogRules.ts");
const manage = loadModule("src/modules/billing/manage.ts");

const at = (iso) => new Date(iso).getTime();

test("cloud task ids match the tasks the app may send online", () => {
  const online = Object.entries(policy.AI_TASK_ROUTES)
    .filter(([, route]) => route.includes("cloud"))
    .map(([task]) => task)
    .sort();
  assert.deepEqual([...rules.CLOUD_AI_TASKS].sort(), online);
  assert.equal(rules.isCloudAiTask("expenseCategory"), false);
  assert.equal(rules.isCloudAiTask("tripName"), true);
});

test("each task draws from the same allowance on server and client", () => {
  for (const task of rules.CLOUD_AI_TASKS) assert.equal(rules.quotaKindFor(task), policy.cloudQuotaFor(task));
});

test("per-feature counts move up and down without going negative", () => {
  let counts = rules.adjustTaskCount(undefined, "tripBudget", 1);
  counts = rules.adjustTaskCount(counts, "tripBudget", 1);
  counts = rules.adjustTaskCount(counts, "chat", -1);
  assert.deepEqual(counts, { tripBudget: 2, chat: 0 });
  assert.deepEqual(rules.fullTaskCounts(counts), {
    chat: 0,
    chatSummary: 0,
    tripBudget: 2,
    tripName: 0,
    voiceExpense: 0,
  });
});

test("allowance resets on the first of next month, UTC", () => {
  assert.equal(rules.usageResetsAt(Date.parse("2026-10-05T12:00:00Z")), Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(rules.usageResetsAt(Date.parse("2026-12-31T23:59:59Z")), Date.parse("2027-01-01T00:00:00Z"));
});

test("usage log keeps only this month and caps its size", () => {
  const old = { task: "chat", provider: "byok", at: at("2026-09-30T12:00:00") };
  const entry = { task: "tripName", provider: "cloud", at: at("2026-10-02T09:00:00") };
  assert.deepEqual(log.appendUsage([old], entry), [entry]);

  let entries = [];
  for (let i = 0; i < log.USAGE_LOG_MAX_ENTRIES + 15; i++) {
    entries = log.appendUsage(entries, { task: "chat", provider: "byok", at: at("2026-10-03T10:00:00") + i });
  }
  assert.equal(entries.length, log.USAGE_LOG_MAX_ENTRIES);
  assert.equal(entries.at(-1).at, at("2026-10-03T10:00:00") + log.USAGE_LOG_MAX_ENTRIES + 14);
});

test("usage summary counts per provider and lists recent first", () => {
  const entries = [
    { task: "chat", provider: "byok", at: at("2026-09-29T08:00:00") },
    { task: "chat", provider: "byok", at: at("2026-10-01T08:00:00") },
    { task: "tripBudget", provider: "byok", at: at("2026-10-02T08:00:00") },
    { task: "chat", provider: "cloud", at: at("2026-10-03T08:00:00") },
  ];
  const summary = log.summarizeUsage(entries, at("2026-10-05T12:00:00"), 2);
  assert.deepEqual(summary.byokCountsByTask, { chat: 1, tripBudget: 1 });
  assert.deepEqual(summary.cloudCountsByTask, { chat: 1 });
  assert.equal(summary.byokTotal, 2);
  assert.deepEqual(
    summary.recent.map((entry) => entry.provider),
    ["cloud", "byok"],
  );
});

const entitlement = (store, expirationDate) => ({ store, expirationDate });

test("manage subscription: test store and lifetime have nothing to open", () => {
  const testInfo = { activeSubscriptions: ["pro_monthly"], managementURL: null, entitlements: { active: { cloud_ai: entitlement("TEST_STORE", "2026-11-01") } } };
  assert.deepEqual(manage.manageTarget(testInfo, "android", "com.pranav.nomadsafe"), { kind: "test" });

  const lifetime = { activeSubscriptions: [], managementURL: null, entitlements: { active: { unlimited_trips: entitlement("PLAY_STORE", null) } } };
  assert.equal(manage.isLifetimePlan(lifetime), true);
  assert.deepEqual(manage.manageTarget(lifetime, "android", "com.pranav.nomadsafe"), { kind: "lifetime" });
});

test("manage subscription: management URL first, else the store page", () => {
  const active = { cloud_ai: entitlement("PLAY_STORE", "2026-11-01") };
  const withUrl = { activeSubscriptions: ["pro_monthly:monthly"], managementURL: "https://example.test/manage", entitlements: { active } };
  assert.deepEqual(manage.manageTarget(withUrl, "android", "pkg"), { kind: "url", url: "https://example.test/manage" });

  const noUrl = { ...withUrl, managementURL: null };
  assert.deepEqual(manage.manageTarget(noUrl, "android", "com.pranav.nomadsafe"), {
    kind: "url",
    url: "https://play.google.com/store/account/subscriptions?sku=pro_monthly&package=com.pranav.nomadsafe",
  });
  assert.deepEqual(manage.manageTarget(noUrl, "ios", "pkg"), { kind: "url", url: "https://apps.apple.com/account/subscriptions" });
  assert.equal(manage.isLifetimePlan(noUrl), false);
});
