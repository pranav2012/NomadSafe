import { v } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { requireAppCheck } from "./appCheck";
import { PRUNE_RATES_AFTER_MS, isCurrencyCode, isDayKey, parseFrankfurterRate, rateExpiry, rateKey } from "./ratesRules";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rate";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  ratesUser: { kind: "token bucket", rate: 120, period: HOUR, capacity: 40 },
});

function validPair(base: string, quote: string, day: string) {
  return isCurrencyCode(base) && isCurrencyCode(quote) && base !== quote && isDayKey(day);
}

/** A query, so Convex serves every user asking for the same pair and day from its cache. */
export const rate = query({
  args: { base: v.string(), quote: v.string(), day: v.string() },
  handler: async (ctx, { base, quote, day }) => {
    if (!validPair(base, quote, day)) return null;
    const row = await ctx.db
      .query("exchangeRates")
      .withIndex("by_key", (q) => q.eq("key", rateKey(base, quote, day)))
      .first();
    return row ? { date: row.date, rate: row.rate, expiresAt: row.expiresAt ?? null } : null;
  },
});

/** Signed-in, rate-limited refresh from Frankfurter; null on any failure so the app falls back to Frankfurter directly. */
export const refresh = action({
  args: { base: v.string(), quote: v.string(), day: v.string(), appCheckToken: v.optional(v.string()) },
  handler: async (ctx, { base, quote, day, appCheckToken }) => {
    if (!validPair(base, quote, day)) return null;
    try {
      await requireAppCheck(appCheckToken);
    } catch {
      return null;
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const { ok } = await rateLimiter.limit(ctx, "ratesUser", { key: identity.subject });
    if (!ok) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${FRANKFURTER_URL}/${base}/${quote}?date=${day}`, { signal: controller.signal });
      if (!response.ok) return null;
      const parsed = parseFrankfurterRate(await response.json());
      if (!parsed) return null;
      const now = Date.now();
      const expiresAt = rateExpiry(day, now);
      await ctx.runMutation(internal.rates.storeRate, { key: rateKey(base, quote, day), ...parsed, expiresAt, fetchedAt: now });
      return { ...parsed, expiresAt: expiresAt ?? null };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
});

export const storeRate = internalMutation({
  args: { key: v.string(), date: v.string(), rate: v.number(), expiresAt: v.optional(v.number()), fetchedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("exchangeRates").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    if (existing) await ctx.db.replace(existing._id, args);
    else await ctx.db.insert("exchangeRates", args);
  },
});

export const pruneRates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("exchangeRates")
      .withIndex("by_fetched", (q) => q.lt("fetchedAt", Date.now() - PRUNE_RATES_AFTER_MS))
      .take(500);
    await Promise.all(old.map((row) => ctx.db.delete(row._id)));
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.rates.pruneRates, {});
  },
});
