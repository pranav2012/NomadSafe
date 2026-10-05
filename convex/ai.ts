import { ConvexError, v } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { action, httpAction, internalMutation, query, type ActionCtx } from "./_generated/server";
import { requireAppCheck } from "./appCheck";
import { userHasCloudAi } from "./billing";
import {
  CLOUD_AI_LIMITS,
  adjustTaskCount,
  fullTaskCounts,
  quotaKindFor,
  remainingQuota,
  usageMonth,
  usageResetsAt,
  type CloudAiTask,
} from "./billingRules";
import { getAuthenticatedUser, requireUser } from "./users";

// NomadSafe Cloud goes through OpenRouter. CLOUD_AI_MODEL switches the model without a deploy.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-6-luna";
const CHAT_MAX_TOKENS = 2048;
const TASK_MAX_TOKENS = 1024;
const MAX_MESSAGES = 60;
const MAX_INPUT_CHARS = 60_000;
const MAX_SCHEMA_CHARS = 8 * 1024;
// OpenAI's json_schema name rule.
const SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// The monthly quota caps cost; this only stops bursts from a leaked session.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  cloudAi: { kind: "token bucket", rate: 240, period: HOUR, capacity: 40 },
});

const taskValidator = v.union(
  v.literal("chat"),
  v.literal("chatSummary"),
  v.literal("tripBudget"),
  v.literal("tripName"),
  v.literal("itinerary"),
  v.literal("voiceExpense"),
);
// Structured tasks `complete` accepts; chat replies only stream through /ai/chat.
const completeTaskValidator = v.union(
  v.literal("chatSummary"),
  v.literal("tripBudget"),
  v.literal("tripName"),
  v.literal("itinerary"),
  v.literal("voiceExpense"),
);
const STREAM_TASKS: readonly CloudAiTask[] = ["chat"];

type Role = "system" | "user" | "assistant";
type Reservation = { ok: true; remaining: number } | { ok: false; reason: "no_plan" | "quota" };
interface Message {
  role: Role;
  content: string;
}

/** Counts one request against the task's monthly allowance and its per-feature counter. */
export const reserve = internalMutation({
  args: { userId: v.string(), task: taskValidator },
  handler: async (ctx, { userId, task }): Promise<Reservation> => {
    if (!(await userHasCloudAi(ctx, userId))) return { ok: false, reason: "no_plan" };
    const kind = quotaKindFor(task);
    const month = usageMonth(Date.now());
    const row = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_month", (q) => q.eq("userId", userId).eq("month", month))
      .unique();
    const used = row?.[kind] ?? 0;
    if (remainingQuota(used, kind) === 0) return { ok: false, reason: "quota" };
    const byTask = adjustTaskCount(row?.byTask, task, 1);
    if (row) await ctx.db.patch(row._id, { [kind]: used + 1, byTask });
    else await ctx.db.insert("aiUsage", { userId, month, chat: 0, tasks: 0, [kind]: 1, byTask });
    return { ok: true, remaining: remainingQuota(used + 1, kind) };
  },
});

/** Gives back a reserved call when the model request itself failed. */
export const refund = internalMutation({
  args: { userId: v.string(), task: taskValidator },
  handler: async (ctx, { userId, task }) => {
    const kind = quotaKindFor(task);
    const row = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_month", (q) => q.eq("userId", userId).eq("month", usageMonth(Date.now())))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, { [kind]: Math.max(0, row[kind] - 1), byTask: adjustTaskCount(row.byTask, task, -1) });
  },
});

export const myUsage = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    const now = Date.now();
    const month = usageMonth(now);
    const row = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_month", (q) => q.eq("userId", user.id).eq("month", month))
      .unique();
    return {
      month,
      chat: { used: row?.chat ?? 0, limit: CLOUD_AI_LIMITS.chat },
      tasks: { used: row?.tasks ?? 0, limit: CLOUD_AI_LIMITS.tasks },
      byTask: fullTaskCounts(row?.byTask),
      resetsAt: usageResetsAt(now),
    };
  },
});

/** Signed in, rate limited, Pro and within quota; returns the user id or the reason it can't run. */
async function authorize(
  ctx: ActionCtx,
  task: CloudAiTask,
): Promise<{ userId: string } | { error: "rate_limited" | "no_plan" | "quota" }> {
  const user = await requireUser(ctx);
  const limited = await rateLimiter.limit(ctx, "cloudAi", { key: user.id });
  if (!limited.ok) return { error: "rate_limited" as const };
  const reserved: Reservation = await ctx.runMutation(internal.ai.reserve, { userId: user.id, task });
  if (!reserved.ok) return { error: reserved.reason };
  return { userId: user.id };
}

function validMessages(value: unknown): Message[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  let total = 0;
  const messages: Message[] = [];
  for (const item of value) {
    const { role, content } = (item ?? {}) as Partial<Message>;
    if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    total += content.length;
    messages.push({ role, content });
  }
  return total <= MAX_INPUT_CHARS ? messages : null;
}

/**
 * One OpenRouter chat completion. Requests only go to providers that don't collect data (the privacy
 * policy relies on this) and that support every parameter sent, so JSON-schema tasks never get a
 * provider that ignores the schema.
 */
/** OpenRouter's error message for logs (it describes the failure, never the user's prompt). */
async function upstreamError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
  const message = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : "";
  return new Error(`OpenRouter HTTP ${res.status}${message ? `: ${message}` : ""}`);
}

function modelRequest(body: Record<string, unknown>) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://play.google.com/store/apps/details?id=com.pranav.nomadsafe",
      "X-OpenRouter-Title": "NomadSafe",
    },
    body: JSON.stringify({
      model: process.env.CLOUD_AI_MODEL || DEFAULT_MODEL,
      provider: { data_collection: "deny", require_parameters: true },
      ...body,
    }),
  });
}

/** One structured task (chat summary, budget, trip name, itinerary, voice). Returns the model's JSON text. */
export const complete = action({
  args: {
    system: v.string(),
    prompt: v.string(),
    schemaName: v.string(),
    schema: v.any(),
    task: completeTaskValidator,
    appCheckToken: v.optional(v.string()),
  },
  handler: async (ctx, { system, prompt, schemaName, schema, task, appCheckToken }): Promise<string> => {
    const schemaJson = JSON.stringify(schema ?? null);
    if (!SCHEMA_NAME.test(schemaName) || schemaJson.length > MAX_SCHEMA_CHARS) throw new ConvexError({ code: "too_large" });
    if (system.length + prompt.length + schemaName.length + schemaJson.length > MAX_INPUT_CHARS) {
      throw new ConvexError({ code: "too_large" });
    }
    await requireAppCheck(appCheckToken);
    const auth = await authorize(ctx, task);
    if ("error" in auth) throw new ConvexError({ code: auth.error });

    try {
      const res = await modelRequest({
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: TASK_MAX_TOKENS,
        reasoning: { effort: "none", exclude: true },
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
      });
      if (!res.ok) throw await upstreamError(res);
      const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
      const text = body.choices?.[0]?.message?.content;
      if (!text) throw new Error("OpenRouter returned no content");
      return text;
    } catch (error) {
      await ctx.runMutation(internal.ai.refund, { userId: auth.userId, task });
      console.error("[ai] task failed", error instanceof Error ? error.message : error);
      throw new ConvexError({ code: "upstream" });
    }
  },
});

function errorResponse(code: string, status: number) {
  return new Response(JSON.stringify({ error: code }), { status, headers: { "Content-Type": "application/json" } });
}

const ERROR_STATUS = { no_plan: 402, quota: 429, rate_limited: 429 } as const;

/**
 * Streams a chat reply as plain UTF-8 text chunks. The app authenticates with its Convex JWT as a
 * Bearer token; OpenRouter's SSE stream is reduced to just the text deltas (its keep-alive comments are skipped).
 */
export const chatStream = httpAction(async (ctx, req) => {
  const user = await getAuthenticatedUser(ctx);
  if (!user) return errorResponse("unauthenticated", 401);
  try {
    await requireAppCheck(req.headers.get("X-Firebase-AppCheck"));
  } catch {
    return errorResponse("app_check", 401);
  }

  const body = (await req.json().catch(() => null)) as { messages?: unknown; task?: unknown } | null;
  const messages = validMessages(body?.messages);
  if (!messages) return errorResponse("bad_request", 400);
  const requested = body?.task ?? "chat";
  const task = STREAM_TASKS.find((id) => id === requested);
  if (!task) return errorResponse("bad_request", 400);

  const auth = await authorize(ctx, task);
  if ("error" in auth) return errorResponse(auth.error, ERROR_STATUS[auth.error]);

  let upstream: Response;
  try {
    upstream = await modelRequest({
      messages,
      max_tokens: CHAT_MAX_TOKENS,
      reasoning: { effort: "low", exclude: true },
      stream: true,
    });
    if (!upstream.ok || !upstream.body) throw await upstreamError(upstream);
  } catch (error) {
    await ctx.runMutation(internal.ai.refund, { userId: auth.userId, task });
    console.error("[ai] chat failed", error instanceof Error ? error.message : error);
    return errorResponse("upstream", 502);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    // Keeps reading until there's text: a pull that enqueues nothing isn't called again, and the
    // stream would stall on OpenRouter's role-only first chunk and keep-alive comments.
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let text = "";
        for (const line of lines) {
          const data = line.startsWith("data:") ? line.slice(5).trim() : "";
          if (!data || data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] };
            text += chunk.choices?.[0]?.delta?.content ?? "";
          } catch {}
        }
        if (text) {
          controller.enqueue(encoder.encode(text));
          return;
        }
      }
    },
    // The app gave up (timeout or Stop). The model call is already paid for, so the request still
    // counts; refunding here would make cancel-before-first-token a free way around the quota.
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
});
