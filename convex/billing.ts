import { v } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAppCheck } from "./appCheck";
import { hasActiveCloudAi, planFromSubscriber, type PlanSnapshot } from "./billingRules";
import { constantTimeEqual } from "./securityRules";
import { getAuthenticatedUser, requireUser } from "./users";

const REVENUECAT_API = "https://api.revenuecat.com/v1";

// Purchases and restores are rare; this keeps a leaked session from hammering RevenueCat's API through us.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  planRefresh: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
});

export async function getEntitlement(ctx: QueryCtx | MutationCtx, userId: string) {
  return ctx.db
    .query("entitlements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function userHasCloudAi(ctx: QueryCtx | MutationCtx, userId: string) {
  return hasActiveCloudAi(await getEntitlement(ctx, userId), Date.now());
}

export async function deleteBillingData(ctx: MutationCtx, userId: string) {
  const entitlement = await getEntitlement(ctx, userId);
  if (entitlement) await ctx.db.delete(entitlement._id);
  const usage = await ctx.db
    .query("aiUsage")
    .withIndex("by_user_month", (q) => q.eq("userId", userId))
    .collect();
  for (const row of usage) await ctx.db.delete(row._id);
}

/** Fetches the user's entitlements from RevenueCat; null when the API isn't configured or fails. */
async function fetchPlan(userId: string): Promise<PlanSnapshot | null> {
  const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
  if (!apiKey) {
    console.warn("[billing] REVENUECAT_SECRET_API_KEY not set; skipping refresh");
    return null;
  }
  const res = await fetch(`${REVENUECAT_API}/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`[billing] RevenueCat lookup failed: HTTP ${res.status}`);
    return null;
  }
  return planFromSubscriber(await res.json(), Date.now());
}

export const savePlan = internalMutation({
  args: {
    userId: v.string(),
    unlimitedTrips: v.boolean(),
    cloudAi: v.boolean(),
    expiresAt: v.optional(v.number()),
    productId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, ...plan }) => {
    const existing = await getEntitlement(ctx, userId);
    const row = { userId, ...plan, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("entitlements", row);
  },
});

export const refreshFromRevenueCat = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const plan = await fetchPlan(userId);
    if (plan) await ctx.runMutation(internal.billing.savePlan, { userId, ...plan });
  },
});

export const planForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const row = await getEntitlement(ctx, userId);
    return { unlimitedTrips: row?.unlimitedTrips ?? false, cloudAi: hasActiveCloudAi(row, Date.now()) };
  },
});

/** Called by the app right after a purchase or restore, so the server doesn't wait for the webhook. */
export const refreshMyPlan = action({
  args: { appCheckToken: v.optional(v.string()) },
  handler: async (ctx, { appCheckToken }): Promise<{ unlimitedTrips: boolean; cloudAi: boolean }> => {
    await requireAppCheck(appCheckToken);
    const user = await requireUser(ctx);
    // Over the limit it returns the stored plan; the webhook still keeps it current.
    const { ok } = await rateLimiter.limit(ctx, "planRefresh", { key: user.id });
    const plan = ok ? await fetchPlan(user.id) : null;
    if (plan) await ctx.runMutation(internal.billing.savePlan, { userId: user.id, ...plan });
    return await ctx.runQuery(internal.billing.planForUser, { userId: user.id });
  },
});

export const myPlan = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    const row = await getEntitlement(ctx, user.id);
    return {
      unlimitedTrips: row?.unlimitedTrips ?? false,
      cloudAi: hasActiveCloudAi(row, Date.now()),
      expiresAt: row?.expiresAt ?? null,
    };
  },
});

interface RevenueCatEvent {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  transferred_from?: string[];
  transferred_to?: string[];
}

const isAnonymousId = (id: string) => id.startsWith("$RCAnonymousID");

/**
 * RevenueCat webhook. The payload only says which users changed; their entitlements are then
 * read back from the REST API, so a forged or reordered event can't grant anything.
 */
export const revenueCatWebhook = httpAction(async (ctx, req) => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected || !constantTimeEqual(req.headers.get("authorization") ?? "", expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { event?: RevenueCatEvent } | null;
  const event = body?.event;
  if (!event) return new Response("Bad request", { status: 400 });

  const ids = new Set(
    [event.app_user_id, event.original_app_user_id, ...(event.transferred_from ?? []), ...(event.transferred_to ?? [])].filter(
      (id): id is string => typeof id === "string" && id.length > 0 && !isAnonymousId(id),
    ),
  );
  for (const userId of ids) {
    await ctx.scheduler.runAfter(0, internal.billing.refreshFromRevenueCat, { userId });
  }
  return new Response(null, { status: 200 });
});

/** Removes the customer from RevenueCat when their account is deleted. Store purchases stay with Google/Apple. */
export const deleteRevenueCatCustomer = internalAction({
  args: { userId: v.string() },
  handler: async (_ctx, { userId }) => {
    const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
    if (!apiKey) return;
    const res = await fetch(`${REVENUECAT_API}/subscribers/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok && res.status !== 404) console.error(`[billing] RevenueCat delete failed: HTTP ${res.status}`);
  },
});
