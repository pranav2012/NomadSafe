import { v } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { requireAppCheck } from "./appCheck";
import { assertMaxLength, isValidCoordinate } from "./securityRules";
import { cloudCell, dailyForecast, hourlyOutlook, parseMetSteps, weatherCell, type PlaceSummary } from "./weatherRules";

const MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0";
// MET's Expires is ~30 min, but a forecast barely changes in 3 h; serving our copy longer is allowed and saves calls.
const MIN_TTL_MS = 3 * HOUR;
const PRUNE_AFTER_MS = 3 * 24 * HOUR;
const CLOUD_PARALLEL = 6;
// Must match CLOUD_STEP / CLOUD_COLS / CLOUD_ROWS in src/features/home/services/globeWeather.ts.
const CLOUD_STEP = 15;
const CLOUD_COLS = 360 / CLOUD_STEP;
const CLOUD_ROWS = 165 / CLOUD_STEP + 1;
const CLOUD_TOP = 82.5;

// A user's own cache misses; normal use is a few places a few times a day. This also keeps total MET
// traffic far under its 20 requests/s per app.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  weatherUser: { kind: "token bucket", rate: 120, period: HOUR, capacity: 30 },
});

/** MET Norway's terms require an identifying User-Agent with a contact. */
function userAgent() {
  return `NomadSafe/1.0 (${process.env.SUPPORT_EMAIL ?? process.env.CONVEX_SITE_URL ?? "nomadsafe"})`;
}

async function fetchMet(product: "complete" | "compact", lat: number, lng: number, lastModified?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`${MET_URL}/${product}?lat=${lat}&lon=${lng}`, {
      headers: { "User-Agent": userAgent(), ...(lastModified ? { "If-Modified-Since": lastModified } : {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a cell from MET Norway and stores the summary; null when unchanged (304) or unavailable, so the
 * caller keeps its copy. Kept to three function calls per miss (this action, the rate limit, the write) for
 * the Convex free plan: the app passes its copy's Last-Modified instead of the action re-reading it.
 */
async function fetchCell(ctx: ActionCtx, latitude: number, longitude: number, lastModified: string | undefined): Promise<PlaceSummary | null> {
  const cell = weatherCell(latitude, longitude);
  const now = Date.now();
  try {
    const response = await fetchMet("complete", cell.lat, cell.lng, lastModified);
    const expiresAt = Math.max(now + MIN_TTL_MS, Date.parse(response.headers.get("expires") ?? "") || 0);
    if (response.status === 304) {
      await ctx.runMutation(internal.weather.touchCell, { key: cell.key, expiresAt });
      return null;
    }
    if (!response.ok) return null;
    const steps = parseMetSteps(await response.json());
    if (!steps.length) return null;
    const summary: PlaceSummary = { days: dailyForecast(steps, cell.lng), hours: hourlyOutlook(steps, now) };
    await ctx.runMutation(internal.weather.storeCell, {
      key: cell.key,
      summary: JSON.stringify(summary),
      lastModified: response.headers.get("last-modified") ?? undefined,
      expiresAt,
    });
    return summary;
  } catch {
    return null;
  }
}

/**
 * A place's cached summary and when it expires. A query, so Convex serves every user asking about the
 * same cell from its cache; the app calls `refresh` only when this is missing or expired.
 */
export const cell = query({
  args: { latitude: v.number(), longitude: v.number() },
  handler: async (ctx, { latitude, longitude }) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const { key } = weatherCell(latitude, longitude);
    const row = await ctx.db.query("weatherCells").withIndex("by_key", (q) => q.eq("key", key)).first();
    return row ? { summary: JSON.parse(row.summary) as PlaceSummary, expiresAt: row.expiresAt, lastModified: row.lastModified } : null;
  },
});

/** Refreshes a missing or expired cell. Signed-in callers only, with a per-user limit, so nobody can drain MET's allowance. */
export const refresh = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    lastModified: v.optional(v.string()),
    appCheckToken: v.optional(v.string()),
  },
  handler: async (ctx, { latitude, longitude, lastModified, appCheckToken }) => {
    // An HTTP date is 29 characters.
    assertMaxLength(lastModified, 64, "lastModified");
    if (!isValidCoordinate(latitude, longitude)) return null;
    // Failing app check gives no fresh data, like any other miss; the app keeps its copy.
    try {
      await requireAppCheck(appCheckToken);
    } catch {
      return null;
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const { ok } = await rateLimiter.limit(ctx, "weatherUser", { key: identity.subject });
    if (!ok) return null;
    return fetchCell(ctx, latitude, longitude, lastModified);
  },
});

export const globeClouds = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("globeClouds").first();
    return row ? { cover: row.cover, storm: row.storm, updatedAt: row.updatedAt } : null;
  },
});

/** Hourly: cloud cover and thunderstorms on the 15° grid, one MET request per cell; failed cells keep their last value. */
export const refreshGlobeClouds = internalAction({
  args: {},
  handler: async (ctx) => {
    const previous = await ctx.runQuery(internal.weather.cloudRow, {});
    const now = Date.now();
    const cells = Array.from({ length: CLOUD_ROWS * CLOUD_COLS }, (_, i) => ({
      lat: CLOUD_TOP - Math.floor(i / CLOUD_COLS) * CLOUD_STEP,
      lng: -180 + (i % CLOUD_COLS) * CLOUD_STEP,
    }));
    const cover: number[] = [];
    const storm: boolean[] = [];
    let filled = 0;
    for (let i = 0; i < cells.length; i += CLOUD_PARALLEL) {
      const batch = await Promise.all(
        cells.slice(i, i + CLOUD_PARALLEL).map(async ({ lat, lng }) => {
          try {
            const response = await fetchMet("compact", lat, lng);
            return response.ok ? cloudCell(parseMetSteps(await response.json()), now) : null;
          } catch {
            return null;
          }
        }),
      );
      batch.forEach((cell, j) => {
        const index = i + j;
        if (cell) filled += 1;
        cover[index] = cell?.cover ?? previous?.cover[index] ?? 0;
        storm[index] = cell?.storm ?? previous?.storm[index] ?? false;
      });
    }
    if (filled > 0) await ctx.runMutation(internal.weather.saveClouds, { cover, storm, updatedAt: now });
  },
});

export const cloudRow = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("globeClouds").first(),
});

export const storeCell = internalMutation({
  args: { key: v.string(), summary: v.string(), lastModified: v.optional(v.string()), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("weatherCells").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    const row = { ...args, fetchedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("weatherCells", row);
  },
});

export const touchCell = internalMutation({
  args: { key: v.string(), expiresAt: v.number() },
  handler: async (ctx, { key, expiresAt }) => {
    const row = await ctx.db.query("weatherCells").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (row) await ctx.db.patch(row._id, { expiresAt, fetchedAt: Date.now() });
  },
});

export const saveClouds = internalMutation({
  args: { cover: v.array(v.number()), storm: v.array(v.boolean()), updatedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("globeClouds").first();
    if (existing) await ctx.db.replace(existing._id, args);
    else await ctx.db.insert("globeClouds", args);
  },
});

/** Daily: drops cells nobody has asked about for a few days. */
export const pruneCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("weatherCells")
      .withIndex("by_fetched", (q) => q.lt("fetchedAt", Date.now() - PRUNE_AFTER_MS))
      .take(500);
    await Promise.all(old.map((row) => ctx.db.delete(row._id)));
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.weather.pruneCache, {});
  },
});
