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
const plan = loadModule("src/modules/billing/plan.ts");
const providers = loadModule("src/modules/ai/remote/providers.ts");
const schemas = loadModule("src/modules/ai/schemas.ts");
const prompts = loadModule("src/modules/ai/prompts.ts");
const memory = loadModule("src/modules/ai/chatMemory.ts");
const policy = loadModule("src/modules/ai/policy.ts");
const adRules = loadModule("src/modules/ads/rules.ts");

const NOW = Date.parse("2026-10-04T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test("RevenueCat: Pro grants cloud AI and unlimited trips", () => {
  const body = {
    subscriber: { entitlements: { cloud_ai: { expires_date: iso(NOW + 30 * day), product_identifier: "pro:monthly" } } },
  };
  const result = rules.planFromSubscriber(body, NOW);
  assert.equal(result.cloudAi, true);
  assert.equal(result.unlimitedTrips, true);
  assert.equal(result.expiresAt, NOW + 30 * day);
  assert.equal(result.productId, "pro:monthly");
});

test("RevenueCat: lifetime Plus never expires and has no cloud AI", () => {
  const body = { subscriber: { entitlements: { unlimited_trips: { expires_date: null, product_identifier: "plus_lifetime" } } } };
  const result = rules.planFromSubscriber(body, NOW);
  assert.deepEqual(result, { unlimitedTrips: true, cloudAi: false, expiresAt: undefined, productId: "plus_lifetime" });
});

test("RevenueCat: expired entitlements count only inside the grace period", () => {
  const expired = { subscriber: { entitlements: { cloud_ai: { expires_date: iso(NOW - day) } } } };
  assert.equal(rules.planFromSubscriber(expired, NOW).cloudAi, false);
  const grace = { subscriber: { entitlements: { cloud_ai: { expires_date: iso(NOW - day), grace_period_expires_date: iso(NOW + day) } } } };
  assert.equal(rules.planFromSubscriber(grace, NOW).cloudAi, true);
  assert.deepEqual(rules.planFromSubscriber({}, NOW), { unlimitedTrips: false, cloudAi: false, expiresAt: undefined, productId: undefined });
});

test("stored plans stop granting cloud AI once expired", () => {
  assert.equal(rules.hasActiveCloudAi({ unlimitedTrips: true, cloudAi: true, expiresAt: NOW - 1 }, NOW), false);
  assert.equal(rules.hasActiveCloudAi({ unlimitedTrips: true, cloudAi: true }, NOW), true);
  assert.equal(rules.hasActiveCloudAi(null, NOW), false);
});

test("cloud AI quota counts down per month", () => {
  assert.equal(rules.usageMonth(NOW), "2026-10");
  assert.equal(rules.remainingQuota(0, "chat"), rules.CLOUD_AI_LIMITS.chat);
  assert.equal(rules.remainingQuota(rules.CLOUD_AI_LIMITS.chat + 5, "chat"), 0);
});

test("free trip limit counts owned trips only", () => {
  const trips = [{}, { shared: { role: "owner" } }, { shared: { role: "member" } }, { shared: { role: "member" } }];
  assert.equal(plan.ownedTripCount(trips), 2);
  assert.equal(plan.canCreateTrip(trips, plan.FREE_PLAN), false);
  assert.equal(plan.canCreateTrip(trips.slice(1), plan.FREE_PLAN), true);
  assert.equal(plan.canCreateTrip(trips, { unlimitedTrips: true, cloudAi: false }), true);
});

test("free group limit counts owned groups only, separately from trips", () => {
  const groups = [{}, { shared: { role: "owner" } }, { shared: { role: "member" } }];
  assert.equal(plan.FREE_GROUP_LIMIT, 2);
  assert.equal(plan.canCreateGroup(groups, plan.FREE_PLAN), false);
  assert.equal(plan.canCreateGroup(groups.slice(1), plan.FREE_PLAN), true);
  assert.equal(plan.canCreateGroup([], plan.FREE_PLAN), true);
  assert.equal(plan.canCreateGroup(groups, { unlimitedTrips: true, cloudAi: false }), true);
});

test("plan tiers from active entitlements", () => {
  assert.equal(plan.tierOf(plan.planFromEntitlements([])), "free");
  assert.equal(plan.tierOf(plan.planFromEntitlements(["unlimited_trips"])), "plus");
  const pro = plan.planFromEntitlements(["cloud_ai"]);
  assert.equal(plan.tierOf(pro), "pro");
  assert.equal(pro.unlimitedTrips, true);
});

test("strictSchema closes every object", () => {
  const voice = schemas.AI_TASKS.voice.schema;
  assert.equal(voice.additionalProperties, false);
  assert.equal(voice.properties.fixed_shares.items.additionalProperties, false);
  assert.equal(voice.properties.split_with.additionalProperties, undefined);
});

const task = schemas.AI_TASKS.tripName;

test("BYOK config needs a key, a model and an https base URL for compatible endpoints", () => {
  assert.equal(providers.isConfigComplete({ provider: "openai", apiKey: "sk", model: "gpt-6-luna" }), true);
  assert.equal(providers.isConfigComplete({ provider: "openai", apiKey: " ", model: "gpt-6-luna" }), false);
  assert.equal(providers.isConfigComplete({ provider: "openai_compatible", apiKey: "k", model: "m", baseUrl: "http://x" }), false);
  assert.equal(providers.isConfigComplete({ provider: "openai_compatible", apiKey: "k", model: "m", baseUrl: "https://openrouter.ai/api/v1" }), true);
});

test("OpenAI JSON request uses a strict schema and low reasoning effort", () => {
  const req = providers.buildJsonRequest({ provider: "openai", apiKey: "sk", model: "gpt-6-luna" }, "sys", "prompt", task);
  const body = JSON.parse(req.body);
  assert.equal(req.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(req.headers.Authorization, "Bearer sk");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.reasoning_effort, "low");
  assert.deepEqual(body.messages.map((m) => m.role), ["system", "user"]);
});

test("OpenAI-compatible JSON request uses JSON mode against the custom base URL", () => {
  const req = providers.buildJsonRequest(
    { provider: "openai_compatible", apiKey: "k", model: "meta/llama", baseUrl: "https://openrouter.ai/api/v1/" },
    "sys",
    "prompt",
    task,
  );
  const body = JSON.parse(req.body);
  assert.equal(req.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, policy.REMOTE_JSON_MAX_TOKENS);
  assert.equal(body.reasoning_effort, undefined);
});

test("Anthropic request moves the system prompt out and sets output_config", () => {
  const req = providers.buildJsonRequest({ provider: "anthropic", apiKey: "ak", model: "claude-opus-5-5" }, "sys", "prompt", task);
  const body = JSON.parse(req.body);
  assert.equal(req.headers["x-api-key"], "ak");
  assert.equal(req.headers["anthropic-version"], "2023-06-01");
  assert.equal(body.system, "sys");
  assert.deepEqual(body.messages, [{ role: "user", content: "prompt" }]);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.effort, "low");
  const haiku = JSON.parse(providers.buildJsonRequest({ provider: "anthropic", apiKey: "ak", model: "claude-haiku-4-5" }, "s", "p", task).body);
  assert.equal(haiku.output_config.effort, undefined);
});

test("Gemini request uses systemInstruction, model role and a JSON schema", () => {
  const chat = providers.buildChatRequest({ provider: "gemini", apiKey: "gk", model: "gemini-3.8-flash" }, [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  const body = JSON.parse(chat.body);
  assert.match(chat.url, /gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
  assert.equal(chat.headers["x-goog-api-key"], "gk");
  assert.equal(body.systemInstruction.parts[0].text, "sys");
  assert.deepEqual(body.contents.map((c) => c.role), ["user", "model"]);
  const json = JSON.parse(providers.buildJsonRequest({ provider: "gemini", apiKey: "gk", model: "gemini-3.8-flash" }, "s", "p", task).body);
  assert.equal(json.generationConfig.responseMimeType, "application/json");
  assert.ok(json.generationConfig.responseJsonSchema);
});

test("responses are parsed per provider", () => {
  assert.equal(providers.parseJsonResponse("openai", { choices: [{ message: { content: "{\"name\":\"A\"}" } }] }), "{\"name\":\"A\"}");
  assert.equal(
    providers.parseJsonResponse("anthropic", { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{}" }] }),
    "{}",
  );
  assert.equal(
    providers.parseJsonResponse("gemini", { candidates: [{ content: { parts: [{ text: "x", thought: true }, { text: "{}" }] } }] }),
    "{}",
  );
  assert.throws(() => providers.parseJsonResponse("openai", { choices: [] }));
});

test("stream events yield only text deltas", () => {
  assert.equal(providers.parseStreamData("openai", JSON.stringify({ choices: [{ delta: { content: "Hi" } }] })), "Hi");
  assert.equal(providers.parseStreamData("openai", "[DONE]"), "");
  assert.equal(
    providers.parseStreamData("anthropic", JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Yo" } })),
    "Yo",
  );
  assert.equal(providers.parseStreamData("anthropic", JSON.stringify({ type: "message_start" })), "");
  assert.throws(() => providers.parseStreamData("anthropic", JSON.stringify({ type: "error", error: { type: "overloaded_error" } })));
});

test("SSE parser joins data lines split across chunks", () => {
  const seen = [];
  const parser = providers.createSseParser((data) => seen.push(data));
  parser.push("event: x\ndata: {\"a\"");
  parser.push(":1}\r\n\ndata: [DO");
  parser.push("NE]");
  parser.end();
  assert.deepEqual(seen, ["{\"a\":1}", "[DONE]"]);
});

test("output parsers validate and clean model JSON", () => {
  assert.deepEqual(prompts.parseTripName("<think>x</think>{\"name\": \" Lisbon Run \"}"), { name: "Lisbon Run" });
  assert.equal(prompts.parseExpenseCategory("{\"category\":\"Food\"}"), "food");
  assert.equal(prompts.parseExpenseCategory("{\"category\":\"fun\"}"), null);
  assert.deepEqual(prompts.parseBudgetEstimate("{\"total\": 1200.4, \"daily\": 171.2, \"rationale\": \"\"}").total, 1200);
  assert.throws(() => prompts.parseBudgetEstimate("{\"total\": 0, \"daily\": 1}"));
  assert.deepEqual(prompts.parseItineraryRefinement("{\"keepIds\":[\"a\",\"z\",\"a\"]}", [{ id: "a" }, { id: "b" }]), { keepIds: ["a"] });
});

test("only the on-device chat prompt promises the reply stays on the phone", () => {
  assert.match(prompts.AI_PROMPTS.systemChatAssistant(false), /stays on the user's device/);
  assert.doesNotMatch(prompts.AI_PROMPTS.systemChatAssistant(true), /device/);
  assert.match(prompts.chatSystemContent(true, "FACTS: x", "earlier"), /FACTS: x[\s\S]*CONVERSATION MEMORY[\s\S]*earlier/);
});

test("chat memory compacts older turns once the prompt passes 60% of the window", async () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i} `.repeat(40) }));
  const short = await memory.compactChatMemory(history.slice(0, 2), "sys", "", 10_000, async () => assert.fail("no summary needed"));
  assert.equal(short.history.length, 2);

  let source = "";
  const compacted = await memory.compactChatMemory(history, "sys", "old summary", 4_000, async (text) => {
    source = text;
    return "new summary";
  });
  assert.equal(compacted.summary, "new summary");
  assert.ok(compacted.history.length < history.length);
  assert.deepEqual(compacted.history.at(-1), history.at(-1));
  assert.match(source, /^old summary/);
});

test("chat memory also compacts when a chat of short turns passes the turn cap", async () => {
  const history = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `hi ${i}` }));
  const untouched = await memory.compactChatMemory(history, "sys", "", 24_000, async () => assert.fail("no summary needed"));
  assert.equal(untouched.history.length, 50);

  const capped = await memory.compactChatMemory(history, "sys", "", 24_000, async () => "summary", 40);
  assert.equal(capped.summary, "summary");
  assert.ok(capped.history.length <= 20);
  assert.deepEqual(capped.history.at(-1), history.at(-1));
});

test("AI policy: categorization stays on the phone and every task has a route", () => {
  assert.deepEqual(policy.AI_TASK_ROUTES.expenseCategory, ["local"]);
  for (const [task, route] of Object.entries(policy.AI_TASK_ROUTES)) assert.ok(route.length > 0, task);
  const online = { onlineAiEnabled: true, hasByokKey: true, cloudAi: true, signedIn: true, cloudExhausted: false };
  assert.deepEqual(policy.onlineProvidersFor("expenseCategory", online), []);
  assert.deepEqual(policy.onlineProvidersFor("chat", online), ["byok", "cloud"]);
  assert.deepEqual(policy.onlineProvidersFor("chat", { ...online, onlineAiEnabled: false }), []);
  assert.deepEqual(policy.onlineProvidersFor("voiceExpense", { ...online, hasByokKey: false, cloudExhausted: true }), []);
});

test("AI policy: a preferred source goes first, then the rest in route order", () => {
  const all = { onlineAiEnabled: true, hasByokKey: true, cloudAi: true, signedIn: true, cloudExhausted: false, localReady: true };
  assert.deepEqual(policy.providerOrder("chat", all), ["byok", "cloud", "local"]);
  assert.deepEqual(policy.providerOrder("chat", { ...all, preferred: "cloud" }), ["cloud", "byok", "local"]);
  assert.deepEqual(policy.onlineProvidersFor("tripBudget", { ...all, preferred: "cloud" }), ["cloud", "byok"]);
  // On-device with a model ready never goes online; without one the automatic order applies.
  assert.deepEqual(policy.providerOrder("voiceExpense", { ...all, preferred: "local" }), ["local"]);
  assert.deepEqual(policy.onlineProvidersFor("chat", { ...all, preferred: "local" }), []);
  assert.deepEqual(policy.providerOrder("chat", { ...all, preferred: "local", localReady: false }), ["byok", "cloud", "local"]);
  // An unusable pick is ignored, not applied.
  assert.equal(policy.effectivePreference("chat", { ...all, preferred: "cloud", signedIn: false }), null);
  assert.equal(policy.effectivePreference("chat", { ...all, preferred: "byok", onlineAiEnabled: false }), null);
  assert.deepEqual(policy.providerOrder("chat", { ...all, preferred: "byok", hasByokKey: false }), ["byok", "cloud", "local"]);
  assert.deepEqual(policy.onlineProvidersFor("chat", { ...all, preferred: "byok", hasByokKey: false }), ["cloud"]);
  // Categorization stays on the phone whatever the pick.
  assert.deepEqual(policy.providerOrder("expenseCategory", { ...all, preferred: "cloud" }), ["local"]);
  assert.deepEqual(policy.onlineProvidersFor("expenseCategory", { ...all, preferred: "byok" }), []);
});

test("ads: shared frequency rules (grace, session delay, gap, session and daily caps)", () => {
  const config = adRules.DEFAULT_AD_CONFIG;
  const DAY = 24 * 60 * 60 * 1000;
  const base = {
    now: NOW,
    config,
    installedAt: NOW - 2 * DAY,
    sessions: 5,
    sessionStartedAt: NOW - 10 * 60 * 1000,
    shownThisSession: 0,
    recentShows: [],
    loaded: true,
  };
  assert.equal(adRules.canShowAd(base), true);
  assert.equal(adRules.canShowAd({ ...base, loaded: false }), false);
  assert.equal(adRules.canShowAd({ ...base, installedAt: NOW - DAY + 1 }), false);
  assert.equal(adRules.canShowAd({ ...base, sessions: config.graceSessions }), false);
  assert.equal(adRules.canShowAd({ ...base, sessionStartedAt: NOW - 30 * 1000 }), false);
  assert.equal(adRules.canShowAd({ ...base, shownThisSession: config.perSession }), false);
  assert.equal(adRules.canShowAd({ ...base, recentShows: [NOW - config.gapSeconds * 1000 + 1] }), false);
  assert.equal(adRules.canShowAd({ ...base, recentShows: [NOW - config.gapSeconds * 1000] }), true);
  const fullDay = Array.from({ length: config.perDay }, (_, i) => NOW - (config.perDay - i) * 3600_000);
  assert.equal(adRules.canShowAd({ ...base, recentShows: fullDay }), false);
  assert.equal(adRules.canShowAd({ ...base, recentShows: [NOW - DAY, ...fullDay.slice(1)] }), true);
  assert.deepEqual(adRules.pruneShows([NOW - DAY, NOW - DAY + 1], NOW), [NOW - DAY + 1]);
});

test("ads: every-Nth placements and remote config overrides", () => {
  assert.equal(adRules.placementDue(3, 4), false);
  assert.equal(adRules.placementDue(4, 4), true);
  assert.equal(adRules.placementDue(9, 0), false);
  assert.deepEqual(adRules.resolveAdConfig(null), adRules.DEFAULT_AD_CONFIG);
  const remote = adRules.resolveAdConfig({ gapSeconds: 300, perDay: -1, perSession: "3", every: { expense_saved: 6, ai_chat_exit: 0, bogus: 1 } });
  assert.equal(remote.gapSeconds, 300);
  assert.equal(remote.perDay, adRules.DEFAULT_AD_CONFIG.perDay);
  assert.equal(remote.perSession, adRules.DEFAULT_AD_CONFIG.perSession);
  assert.equal(remote.every.expense_saved, 6);
  assert.equal(remote.every.ai_chat_exit, 0);
  assert.equal(remote.every.trip_created, 1);
  assert.equal("bogus" in remote.every, false);
});
