import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { syncKindValidator } from "./schema";
import { assertMaxLength, clampClientTime, stripEmailNote } from "./securityRules";
import { requireUser } from "./users";

const MAX_BATCH = 100;
const MAX_RECORD_BYTES = 64 * 1024;
const PURGE_BATCH = 500;
const MAX_RECORDS_PER_USER = 20_000;
export const MAX_CLIENT_ID = 128;

// A first backup of a big history is a few hundred batches; this only stops a script filling the database.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  syncPush: { kind: "token bucket", rate: 600, period: HOUR, capacity: 200 },
});

const recordValidator = v.object({
  kind: syncKindValidator,
  clientId: v.string(),
  data: v.optional(v.any()),
  deleted: v.boolean(),
  updatedAt: v.number(),
});

/**
 * Stores a batch of the caller's records, last write wins by `updatedAt`. Each accepted write
 * gets the next value of the caller's sequence so other devices can pull it.
 */
export const push = mutation({
  args: { records: v.array(recordValidator) },
  handler: async (ctx, { records }) => {
    const user = await requireUser(ctx);
    if (records.length > MAX_BATCH) throw new Error("Too many records");
    for (const record of records) assertMaxLength(record.clientId, MAX_CLIENT_ID, "clientId");
    await rateLimiter.limit(ctx, "syncPush", { key: user.id, throws: true });

    const now = Date.now();
    const state = await ctx.db
      .query("syncState")
      .withIndex("by_user", (q) => q.eq("userId", user.id))
      .unique();
    let seq = state?.seq ?? 0;
    let stored = state?.records ?? 0;
    let accepted = 0;
    let rejectedSeq: number | null = null;

    for (const record of records) {
      if (!record.deleted && JSON.stringify(record.data ?? null).length > MAX_RECORD_BYTES) {
        throw new Error("Record too large");
      }
      const existing = await ctx.db
        .query("syncRecords")
        .withIndex("by_user_record", (q) =>
          q.eq("userId", user.id).eq("kind", record.kind).eq("clientId", record.clientId),
        )
        .unique();
      const updatedAt = clampClientTime(record.updatedAt, now);
      if (existing && existing.updatedAt > updatedAt) {
        rejectedSeq = Math.min(rejectedSeq ?? existing.serverSeq, existing.serverSeq);
        continue;
      }
      if (!existing) {
        if (stored >= MAX_RECORDS_PER_USER) throw new Error("Backup is full");
        stored += 1;
      }

      seq += 1;
      accepted += 1;
      const doc = {
        userId: user.id,
        kind: record.kind,
        clientId: record.clientId,
        data: record.deleted ? undefined : stripEmailNote(record.data),
        deleted: record.deleted,
        updatedAt,
        serverSeq: seq,
      };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("syncRecords", doc);
    }

    if (state) await ctx.db.patch(state._id, { seq, records: stored });
    else await ctx.db.insert("syncState", { userId: user.id, seq, records: stored });
    // The client re-pulls from just before the oldest rejected record to adopt the newer version.
    return { accepted, rejectedSeq };
  },
});

/** The caller's records written after sequence `after`, oldest first. */
export const pull = query({
  args: { after: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { after, paginationOpts }) => {
    const user = await requireUser(ctx);
    const page = await ctx.db
      .query("syncRecords")
      .withIndex("by_user_seq", (q) => q.eq("userId", user.id).gt("serverSeq", after))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((doc) => ({
        kind: doc.kind,
        clientId: doc.clientId,
        data: doc.data,
        deleted: doc.deleted,
        updatedAt: doc.updatedAt,
        serverSeq: doc.serverSeq,
      })),
    };
  },
});

/** Deletes up to one batch of a user's backup; returns true once nothing is left. */
export async function deleteSyncBatch(ctx: MutationCtx, userId: string): Promise<boolean> {
  const batch = await ctx.db
    .query("syncRecords")
    .withIndex("by_user_seq", (q) => q.eq("userId", userId))
    .take(PURGE_BATCH);
  for (const doc of batch) await ctx.db.delete(doc._id);
  if (batch.length === PURGE_BATCH) return false;
  const state = await ctx.db
    .query("syncState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (state) await ctx.db.delete(state._id);
  return true;
}

/** Backup turned off: removes the caller's backup in batches, continuing in the background. */
export const deleteBackup = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const done = await deleteSyncBatch(ctx, user.id);
    if (!done) await ctx.scheduler.runAfter(0, internal.sync.purgeUserRecords, { userId: user.id });
    return { done };
  },
});

/** Background purge for large backups (account deletion, backup turned off). */
export const purgeUserRecords = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const done = await deleteSyncBatch(ctx, userId);
    if (!done) await ctx.scheduler.runAfter(0, internal.sync.purgeUserRecords, { userId });
  },
});
