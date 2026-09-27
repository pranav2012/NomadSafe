import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  findAuthUserByEmail,
  findAuthUserById,
  getAuthenticatedUser,
  normalizeEmail,
  requireUser,
} from "./users";

const MAX_NAME = 80;
const MAX_EMAIL = 254;
const MAX_PHONE = 32;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const modeValidator = v.union(
  v.literal("normal"),
  v.literal("low"),
  v.literal("emergency"),
);

function cleanName(name: string) {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed) throw new Error("Name is required");
  return trimmed;
}

export const me = query({
  args: {},
  handler: async (ctx) => {
    return getAuthenticatedUser(ctx);
  },
});

/**
 * Checks whether an email belongs to a NomadSafe user. Auth-only and returns
 * just the display name so it can't be used to harvest profiles.
 */
export const findUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    if (email.length > MAX_EMAIL || !EMAIL_RE.test(email.trim())) return null;
    const match = await findAuthUserByEmail(ctx, email);
    if (!match || match.id === user.id) return null;
    return { id: match.id, name: match.name };
  },
});

export const getContactLinks = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return { outgoing: [], incoming: [], invites: [] };

    const [outgoing, incoming, invites] = await Promise.all([
      ctx.db
        .query("contactLinks")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
        .collect(),
      ctx.db
        .query("contactLinks")
        .withIndex("by_linked", (q) => q.eq("linkedUserId", user.id))
        .collect(),
      ctx.db
        .query("pendingInvites")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
        .collect(),
    ]);

    const incomingWithOwner = await Promise.all(
      incoming.map(async (link) => {
        const owner = await findAuthUserById(ctx, link.ownerUserId);
        return {
          id: link._id,
          ownerUserId: link.ownerUserId,
          ownerName: owner?.name || owner?.email || "",
          ownerEmail: owner?.email ?? null,
          status: link.status,
          createdAt: link.createdAt,
        };
      }),
    );

    return {
      outgoing: outgoing.map((link) => ({
        id: link._id,
        linkedUserId: link.linkedUserId,
        name: link.name,
        email: link.email,
        status: link.status,
      })),
      incoming: incomingWithOwner,
      invites: invites.map((invite) => ({
        id: invite._id,
        name: invite.name,
        email: invite.email ?? null,
        phone: invite.phone ?? null,
        invitedAt: invite.invitedAt,
      })),
    };
  },
});

/**
 * Asks another user to receive the caller's live location. Existing users get
 * a pending link they must accept; unknown emails become a pending invite that
 * is claimed when that person signs up (see `claimInvites`).
 */
export const requestContactLink = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = cleanName(args.name);
    const email = normalizeEmail(args.email);
    if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) throw new Error("Invalid email");
    const phone = args.phone?.trim().slice(0, MAX_PHONE) || undefined;
    if (email === user.email) throw new Error("Cannot link to yourself");

    const existingLink = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner_email", (q) => q.eq("ownerUserId", user.id).eq("email", email))
      .unique();

    const target = await findAuthUserByEmail(ctx, email);
    if (target && target.id === user.id) throw new Error("Cannot link to yourself");

    if (existingLink) {
      if (existingLink.status === "declined") {
        await ctx.db.patch(existingLink._id, { status: "pending", updatedAt: Date.now() });
        return { linkId: existingLink._id, status: "pending" as const, linkedUserId: existingLink.linkedUserId };
      }
      return { linkId: existingLink._id, status: existingLink.status, linkedUserId: existingLink.linkedUserId };
    }

    if (!target) {
      const invite = await ctx.db
        .query("pendingInvites")
        .withIndex("by_owner_email", (q) => q.eq("ownerUserId", user.id).eq("email", email))
        .first();
      if (!invite) {
        await ctx.db.insert("pendingInvites", {
          ownerUserId: user.id,
          name,
          email,
          phone,
          invitedAt: Date.now(),
        });
      }
      return { linkId: null, status: "invite_pending" as const, linkedUserId: null };
    }

    const now = Date.now();
    const linkId = await ctx.db.insert("contactLinks", {
      ownerUserId: user.id,
      linkedUserId: target.id,
      name,
      email,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { linkId, status: "pending" as const, linkedUserId: target.id };
  },
});

/** Converts invites addressed to the caller's email into pending link requests. */
export const claimInvites = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user?.email) return { claimed: 0 };
    const email = normalizeEmail(user.email);

    const invites = await ctx.db
      .query("pendingInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();

    let claimed = 0;
    for (const invite of invites) {
      await ctx.db.delete(invite._id);
      if (invite.ownerUserId === user.id) continue;
      const existing = await ctx.db
        .query("contactLinks")
        .withIndex("by_owner_email", (q) => q.eq("ownerUserId", invite.ownerUserId).eq("email", email))
        .unique();
      if (existing) continue;
      const now = Date.now();
      await ctx.db.insert("contactLinks", {
        ownerUserId: invite.ownerUserId,
        linkedUserId: user.id,
        name: invite.name,
        email,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      claimed += 1;
    }
    return { claimed };
  },
});

export const respondToContactLink = mutation({
  args: {
    linkId: v.id("contactLinks"),
    accept: v.boolean(),
  },
  handler: async (ctx, { linkId, accept }) => {
    const user = await requireUser(ctx);
    const link = await ctx.db.get(linkId);
    if (!link || link.linkedUserId !== user.id) throw new Error("Link not found");

    const nextStatus = accept ? "accepted" : "declined";
    await ctx.db.patch(linkId, { status: nextStatus, updatedAt: Date.now() });

    if (!accept) {
      const share = await ctx.db
        .query("locationShares")
        .withIndex("by_owner_recipient", (q) =>
          q.eq("ownerUserId", link.ownerUserId).eq("recipientUserId", user.id),
        )
        .unique();
      if (share) await ctx.db.delete(share._id);
    }
    return { status: nextStatus };
  },
});

/** Removes a link from either side, along with any location share on it. */
export const removeContactLink = mutation({
  args: { linkId: v.id("contactLinks") },
  handler: async (ctx, { linkId }) => {
    const user = await requireUser(ctx);
    const link = await ctx.db.get(linkId);
    if (!link || (link.ownerUserId !== user.id && link.linkedUserId !== user.id)) {
      throw new Error("Link not found");
    }

    await ctx.db.delete(linkId);
    const share = await ctx.db
      .query("locationShares")
      .withIndex("by_owner_recipient", (q) =>
        q.eq("ownerUserId", link.ownerUserId).eq("recipientUserId", link.linkedUserId),
      )
      .unique();
    if (share) await ctx.db.delete(share._id);
    return { ok: true };
  },
});

export const removeInvite = mutation({
  args: { inviteId: v.id("pendingInvites") },
  handler: async (ctx, { inviteId }) => {
    const user = await requireUser(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite || invite.ownerUserId !== user.id) throw new Error("Invite not found");
    await ctx.db.delete(inviteId);
    return { ok: true };
  },
});

/**
 * Publishes the caller's location to every accepted link, skipping recipients
 * the caller paused. Called by the foreground app and the background task.
 */
export const publishLocation = mutation({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    battery: v.optional(v.number()),
    mode: modeValidator,
  },
  handler: async (ctx, { latitude, longitude, battery, mode }) => {
    const user = await requireUser(ctx);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      throw new Error("Invalid coordinates");
    }
    const safeBattery =
      typeof battery === "number" && battery >= 0 && battery <= 1 ? battery : undefined;

    const acceptedLinks = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();

    const now = Date.now();
    let recipients = 0;
    for (const link of acceptedLinks) {
      const existing = await ctx.db
        .query("locationShares")
        .withIndex("by_owner_recipient", (q) =>
          q.eq("ownerUserId", user.id).eq("recipientUserId", link.linkedUserId),
        )
        .unique();

      if (existing?.paused) continue;
      recipients += 1;
      if (existing) {
        await ctx.db.patch(existing._id, {
          latitude,
          longitude,
          battery: safeBattery,
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
          battery: safeBattery,
          mode,
          active: true,
          paused: false,
          updatedAt: now,
        });
      }
    }
    return { recipients };
  },
});

export const setSharePaused = mutation({
  args: { recipientUserId: v.string(), paused: v.boolean() },
  handler: async (ctx, { recipientUserId, paused }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("locationShares")
      .withIndex("by_owner_recipient", (q) =>
        q.eq("ownerUserId", user.id).eq("recipientUserId", recipientUserId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        paused,
        active: paused ? false : existing.active,
        updatedAt: Date.now(),
      });
    } else if (paused) {
      await ctx.db.insert("locationShares", {
        ownerUserId: user.id,
        recipientUserId,
        latitude: 0,
        longitude: 0,
        mode: "normal",
        active: false,
        paused: true,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

/** Marks all of the caller's shares inactive so contacts stop seeing "live". */
export const stopSharing = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return { ok: false };
    const shares = await ctx.db
      .query("locationShares")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .collect();
    const now = Date.now();
    for (const share of shares) {
      if (share.active) await ctx.db.patch(share._id, { active: false, updatedAt: now });
    }
    return { ok: true };
  },
});

export const getIncomingShares = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const shares = await ctx.db
      .query("locationShares")
      .withIndex("by_recipient", (q) => q.eq("recipientUserId", user.id))
      .filter((q) => q.eq(q.field("active"), true))
      .take(50);

    return Promise.all(
      shares.map(async (share) => {
        const owner = await findAuthUserById(ctx, share.ownerUserId);
        return {
          ownerUserId: share.ownerUserId,
          ownerName: owner?.name || owner?.email || "",
          latitude: share.latitude,
          longitude: share.longitude,
          battery: share.battery ?? null,
          mode: share.mode,
          updatedAt: share.updatedAt,
        };
      }),
    );
  },
});

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
      active: share.active,
      paused: share.paused ?? false,
      mode: share.mode,
      updatedAt: share.updatedAt,
    }));
  },
});
