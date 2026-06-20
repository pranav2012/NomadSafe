import { v } from "convex/values";
import { query, mutation, httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { authComponent } from "./auth";
import type { QueryCtx, MutationCtx } from "./_generated/server";

/**
 * Normalise an email for reliable lookups. Lowercases and trims whitespace.
 */
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Returns the currently signed-in user from Better Auth.
 * The Better Auth user document uses `_id` for the Convex document id and
 * `userId` for the public Better Auth user id we expose to clients.
 */
async function getAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.getAuthUser(ctx);
  return user
    ? {
        id: (user as unknown as { _id: string; userId?: string | null }).userId ?? (user as unknown as { _id: string })._id,
        name: user.name ?? "",
        email: (user as unknown as { email?: string | null }).email ?? null,
        phone: (user as unknown as { phone?: string | null }).phone ?? null,
        image: (user as unknown as { image?: string | null }).image ?? null,
      }
    : null;
}
function userId(user: { _id: string; userId?: string | null }) {
  return user.userId ?? user._id;
}


/**
 * Query the current user's public profile.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    return {
      id: user.id,
      name: user.name ?? "",
      email: user.email ?? null,
      phone: user.phone ?? null,
      image: user.image ?? null,
    };
  },
});

/**
 * Search for a NomadSafe user by email address. Returns null if no match.
 * Used during onboarding / sharing to suggest a link instead of SMS-only.
 */
export const findUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = normalizeEmail(email);
    const match = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (!match) return null;
    return {
      id: userId(match as any),
      userId: userId(match as any),
      name: match.name,
      email: match.email ?? null,
      avatarUrl: match.avatarUrl ?? null,
    };
  },
});

/**
 * Get all contact links for the current user (outgoing + incoming).
 */
export const getContactLinks = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const [outgoing, incoming] = await Promise.all([
      ctx.db
        .query("contactLinks")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
        .collect(),
      ctx.db
        .query("contactLinks")
        .withIndex("by_linked", (q) => q.eq("linkedUserId", user.id))
        .collect(),
    ]);

    return {
      outgoing: outgoing.map((link) => ({
        id: link._id,
        linkedUserId: link.linkedUserId,
        name: link.name,
        email: link.email,
        status: link.status,
      })),
      incoming: incoming.map((link) => ({
        id: link._id,
        ownerUserId: link.ownerUserId,
        name: link.name,
        email: link.email,
        status: link.status,
      })),
    };
  },
});

/**
 * Create or re-create an outgoing contact link to another NomadSafe user by email.
 * If the target user exists, a pending link request is created.
 * If not, a pending invite record is stored for the invite flow.
 */
export const requestContactLink = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, { name, email, phone }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new Error("Not authenticated");

    const normalizedEmail = normalizeEmail(email);
    const existingLink = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner_email", (q) =>
        q.eq("ownerUserId", user.id).eq("email", normalizedEmail),
      )
      .unique();
    if (existingLink) return { linkId: existingLink._id, status: existingLink.status };

    const target = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();

    if (!target) {
      // No NomadSafe account yet; store a pending invite.
      await ctx.db.insert("pendingInvites", {
        ownerUserId: user.id,
        name,
        email: normalizedEmail,
        phone,
        invitedAt: Date.now(),
      });
      return { linkId: null, status: "invite_pending" as const };
    }

    if (userId(target) === user.id) {
      throw new Error("Cannot link to yourself");
    }

    const linkId = await ctx.db.insert("contactLinks", {
      ownerUserId: user.id,
      linkedUserId: userId(target),
      name,
      email: normalizedEmail,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { linkId, status: "pending" as const };
  },
});

/**
 * Accept or decline an incoming contact-link request.
 */
export const respondToContactLink = mutation({
  args: {
    linkId: v.id("contactLinks"),
    accept: v.boolean(),
  },
  handler: async (ctx, { linkId, accept }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new Error("Not authenticated");

    const link = await ctx.db.get(linkId);
    if (!link || link.linkedUserId !== user.id) {
      throw new Error("Link not found");
    }

    const nextStatus = accept ? "accepted" : "declined";
    await ctx.db.patch(linkId, {
      status: nextStatus,
      updatedAt: Date.now(),
    });

    return { status: nextStatus };
  },
});

/**
 * Remove an outgoing contact link (and any active share).
 */
export const removeContactLink = mutation({
  args: { linkId: v.id("contactLinks") },
  handler: async (ctx, { linkId }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new Error("Not authenticated");

    const link = await ctx.db.get(linkId);
    if (!link || link.ownerUserId !== user.id) {
      throw new Error("Link not found");
    }

    await ctx.db.delete(linkId);

    const share = await ctx.db
      .query("locationShares")
      .withIndex("by_owner_recipient", (q) =>
        q.eq("ownerUserId", user.id).eq("recipientUserId", link.linkedUserId),
      )
      .unique();
    if (share) await ctx.db.delete(share._id);

    return { ok: true };
  },
});

/**
 * Publish the current user's location from the mobile background task.
 * Upserts an active share row for each accepted contact link.
 */
export const publishLocation = mutation({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    battery: v.optional(v.number()),
    mode: v.union(
      v.literal("normal"),
      v.literal("low"),
      v.literal("emergency"),
    ),
  },
  handler: async (ctx, { latitude, longitude, battery, mode }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new Error("Not authenticated");

    const acceptedLinks = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();

    const now = Date.now();

    for (const link of acceptedLinks) {
      const existing = await ctx.db
        .query("locationShares")
        .withIndex("by_owner_recipient", (q) =>
          q.eq("ownerUserId", user.id).eq("recipientUserId", link.linkedUserId),
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          latitude,
          longitude,
          battery,
          mode,
          updatedAt: now,
          active: true,
        });
      } else {
        await ctx.db.insert("locationShares", {
          ownerUserId: user.id,
          recipientUserId: link.linkedUserId,
          latitude,
          longitude,
          battery,
          mode,
          active: true,
          updatedAt: now,
        });
      }
    }

    return { recipients: acceptedLinks.length };
  },
});

/**
 * Pause sharing with a specific recipient (sets active=false). The background
 * task will skip paused recipients until toggled back on.
 */
export const pauseShare = mutation({
  args: { recipientUserId: v.string() },
  handler: async (ctx, { recipientUserId }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("locationShares")
      .withIndex("by_owner_recipient", (q) =>
        q.eq("ownerUserId", user.id).eq("recipientUserId", recipientUserId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { active: false, updatedAt: Date.now() });
    }
    return { ok: true };
  },
});

/**
 * Get the latest incoming location shares for the current user.
 * Live Convex subscription feeds the Sharing map + recipient list.
 */
export const getIncomingShares = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const shares = await ctx.db
      .query("locationShares")
      .withIndex("by_recipient", (q) => q.eq("recipientUserId", user.id))
      .filter((q) => q.eq(q.field("active"), true))
      .order("desc")
      .take(50);

    return shares.map((share) => ({
      ownerUserId: share.ownerUserId,
      latitude: share.latitude,
      longitude: share.longitude,
      battery: share.battery ?? null,
      mode: share.mode,
      updatedAt: share.updatedAt,
    }));
  },
});

/**
 * Get outgoing shares for the current user (used to show who is receiving).
 */
export const getOutgoingShares = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const shares = await ctx.db
      .query("locationShares")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .collect();

    return shares.map((share) => ({
      recipientUserId: share.recipientUserId,
      latitude: share.latitude,
      longitude: share.longitude,
      battery: share.battery ?? null,
      mode: share.mode,
      active: share.active,
      updatedAt: share.updatedAt,
    }));
  },
});

/**
 * HTTP action that the mobile background task can call to publish location.
 * Better Auth session cookies are forwarded by fetch, so ctx.auth.getUser()
 * still works. Accepts a JSON body and delegates to publishLocation.
 */
export const publishLocationHttp = httpAction(async (ctx, req) => {
  try {
    const body = await req.json();
    const { latitude, longitude, battery, mode } = body;

    const validMode =
      mode === "normal" || mode === "low" || mode === "emergency"
        ? mode
        : "normal";

    const result = await ctx.runMutation(api.sharing.publishLocation, {
      latitude,
      longitude,
      battery: typeof battery === "number" ? battery : undefined,
      mode: validMode,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
