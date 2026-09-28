import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { POSTHOG_DELETE_DELAY_MS } from "./analytics";
import { findAuthUserByEmail, normalizeEmail, requireUser } from "./users";

type AuthModel = "session" | "account" | "user";

async function deleteAuthRows(ctx: MutationCtx, model: AuthModel, field: string, value: string) {
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const result = (await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model, where: [{ field, operator: "eq", value }] } as never,
      paginationOpts: { cursor, numItems: 100 },
    })) as { isDone?: boolean; continueCursor?: string } | null;
    if (!result || result.isDone !== false || !result.continueCursor) return;
    cursor = result.continueCursor;
  }
}

/**
 * Deletes every server-side record tied to a user: sharing links in both
 * directions, location shares, invites they sent or received, and finally
 * their Better Auth sessions, linked accounts and user record. Their PostHog
 * analytics are deleted by a scheduled action, which only runs if this commits.
 */
async function purgeUser(ctx: MutationCtx, userId: string, email: string | null) {
  const owned = await ctx.db
    .query("contactLinks")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .collect();
  const linked = await ctx.db
    .query("contactLinks")
    .withIndex("by_linked", (q) => q.eq("linkedUserId", userId))
    .collect();
  for (const link of [...owned, ...linked]) await ctx.db.delete(link._id);

  const sharesOut = await ctx.db
    .query("locationShares")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .collect();
  const sharesIn = await ctx.db
    .query("locationShares")
    .withIndex("by_recipient", (q) => q.eq("recipientUserId", userId))
    .collect();
  for (const share of [...sharesOut, ...sharesIn]) await ctx.db.delete(share._id);

  const invitesSent = await ctx.db
    .query("pendingInvites")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .collect();
  const invitesReceived = email
    ? await ctx.db
        .query("pendingInvites")
        .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
        .collect()
    : [];
  for (const invite of [...invitesSent, ...invitesReceived]) await ctx.db.delete(invite._id);

  await deleteAuthRows(ctx, "session", "userId", userId);
  await deleteAuthRows(ctx, "account", "userId", userId);
  await deleteAuthRows(ctx, "user", "_id", userId);

  await ctx.scheduler.runAfter(POSTHOG_DELETE_DELAY_MS, internal.analytics.deletePostHogPerson, {
    distinctId: userId,
    attempt: 0,
  });
}

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await purgeUser(ctx, user.id, user.email);
    if (user.email) {
      const requests = await ctx.db
        .query("deletionRequests")
        .withIndex("by_email", (q) => q.eq("email", normalizeEmail(user.email!)))
        .collect();
      for (const request of requests) await ctx.db.patch(request._id, { status: "completed" });
    }
    return { ok: true };
  },
});

export const requestDeletionByEmail = internalMutation({
  args: { email: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { email, reason }) => {
    const normalized = normalizeEmail(email).slice(0, 254);
    const existing = await ctx.db
      .query("deletionRequests")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (existing) return { ok: true };
    await ctx.db.insert("deletionRequests", {
      email: normalized,
      reason: reason?.slice(0, 1000),
      requestedAt: Date.now(),
      status: "pending",
    });
    return { ok: true };
  },
});

/**
 * Run from the Convex dashboard after verifying a web deletion request
 * (e.g. by replying to the requester's email) to purge that account.
 */
export const processDeletionRequest = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = normalizeEmail(email);
    const user = await findAuthUserByEmail(ctx, normalized);
    if (user) await purgeUser(ctx, user.id, user.email);
    const requests = await ctx.db
      .query("deletionRequests")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .collect();
    for (const request of requests) await ctx.db.patch(request._id, { status: "completed" });
    return { deletedUser: !!user };
  },
});
