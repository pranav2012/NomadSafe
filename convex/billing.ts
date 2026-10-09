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
import { effectivePlan, planFromSubscriber, type PlanSnapshot } from "./billingRules";
import { constantTimeEqual } from "./securityRules";
import { findAuthUserByEmail, findAuthUserById, getAuthenticatedUser, requireUser } from "./users";

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

async function getGrant(ctx: QueryCtx | MutationCtx, userId: string) {
  return ctx.db
    .query("planGrants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** The user's plan from RevenueCat and any grant combined. */
async function planOf(ctx: QueryCtx | MutationCtx, userId: string) {
  const [purchased, granted] = await Promise.all([getEntitlement(ctx, userId), getGrant(ctx, userId)]);
  return { purchased, ...effectivePlan(purchased, granted, Date.now()) };
}

export async function userHasCloudAi(ctx: QueryCtx | MutationCtx, userId: string) {
  return (await planOf(ctx, userId)).cloudAi;
}

export async function deleteBillingData(ctx: MutationCtx, userId: string) {
  const entitlement = await getEntitlement(ctx, userId);
  if (entitlement) await ctx.db.delete(entitlement._id);
  const grant = await getGrant(ctx, userId);
  if (grant) await ctx.db.delete(grant._id);
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
    const { unlimitedTrips, cloudAi } = await planOf(ctx, userId);
    return { unlimitedTrips, cloudAi };
  },
});

const tierArg = v.union(v.literal("plus"), v.literal("pro"));

async function saveGrant(ctx: MutationCtx, userId: string, tier: "plus" | "pro", note: string, days?: number) {
  const existing = await getGrant(ctx, userId);
  const row = {
    userId,
    unlimitedTrips: true,
    cloudAi: tier === "pro",
    expiresAt: days ? Date.now() + days * 24 * 60 * 60 * 1000 : undefined,
    note,
    createdAt: Date.now(),
  };
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("planGrants", row);
}

/**
 * Gives a plan without a purchase (`npx convex run billing:grantPlan '{"userId":"…","tier":"pro","note":"…"}'`).
 * `days` limits it; without it the grant lasts until revoked.
 */
export const grantPlan = internalMutation({
  args: { userId: v.string(), tier: tierArg, note: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { userId, tier, note, days }) => {
    await saveGrant(ctx, userId, tier, note, days);
  },
});

export const revokePlan = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const existing = await getGrant(ctx, userId);
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Hourly cron: deletes expired grants. Queries don't re-run as time passes, so the deletion is what drops the plan on phones. */
export const pruneExpiredGrants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const grant of await ctx.db.query("planGrants").collect()) {
      if (grant.expiresAt !== undefined && grant.expiresAt <= now) await ctx.db.delete(grant._id);
    }
  },
});

/**
 * Grants a plan to signed-up accounts by email, e.g. testers:
 * `npx convex run --prod billing:grantPlanByEmail '{"emails":["a@x.com"],"tier":"pro","note":"beta","days":30}'`.
 * Emails with no account yet are listed in `notFound`; they need to sign in once first.
 */
export const grantPlanByEmail = internalMutation({
  args: { emails: v.array(v.string()), tier: tierArg, note: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { emails, tier, note, days }) => {
    const granted: string[] = [];
    const notFound: string[] = [];
    for (const email of emails) {
      const user = await findAuthUserByEmail(ctx, email);
      if (!user) {
        notFound.push(email);
        continue;
      }
      await saveGrant(ctx, user.id, tier, note, days);
      granted.push(email);
    }
    return { granted, notFound };
  },
});

export const revokePlanByEmail = internalMutation({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, { emails }) => {
    const revoked: string[] = [];
    for (const email of emails) {
      const user = await findAuthUserByEmail(ctx, email);
      const grant = user ? await getGrant(ctx, user.id) : null;
      if (!grant) continue;
      await ctx.db.delete(grant._id);
      revoked.push(email);
    }
    return { revoked };
  },
});

/** Every active grant with its account email (`npx convex run --prod billing:listGrants`). */
export const listGrants = internalQuery({
  args: {},
  handler: async (ctx) => {
    const grants = await ctx.db.query("planGrants").collect();
    return Promise.all(
      grants.map(async (grant) => ({
        email: (await findAuthUserById(ctx, grant.userId))?.email ?? null,
        tier: grant.cloudAi ? "pro" : "plus",
        expiresAt: grant.expiresAt ? new Date(grant.expiresAt).toISOString() : null,
        note: grant.note,
      })),
    );
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
    const { purchased, unlimitedTrips, cloudAi } = await planOf(ctx, user.id);
    return { unlimitedTrips, cloudAi, expiresAt: purchased?.expiresAt ?? null };
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
