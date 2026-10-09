import { v } from "convex/values";
import { DAY, HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { newInviteCode, normalizeInviteCode } from "./securityRules";
import {
  type AppUser,
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
const DECLINE_COOLDOWN_MS = 7 * DAY;
// A share shows until its end time. One with no end (or an SOS) is hidden after this long without an
// update: the phone stopped publishing without saying so. Phones publish only when they move.
const SHARE_STALE_MS = 48 * HOUR;
// Longest share the app offers is 24 h (SHARE_DURATIONS in src/features/location-sharing/store/sharingStore.ts).
const MAX_SHARE_MS = 25 * HOUR;

// Each lookup reveals whether an email has an account, so it is metered per user.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  emailLookup: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
  // Joining is one tap per invite; this stops scripted guessing of circle codes.
  circleJoin: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
  circleCode: { kind: "token bucket", rate: 10, period: HOUR, capacity: 5 },
});

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
export const findUserByEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    if (email.length > MAX_EMAIL || !EMAIL_RE.test(email.trim())) return null;
    await rateLimiter.limit(ctx, "emailLookup", { key: user.id, throws: true });
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
    if (args.name.length > MAX_NAME * 4 || (args.phone?.length ?? 0) > MAX_PHONE * 4) throw new Error("Input too long");
    const name = cleanName(args.name);
    const email = normalizeEmail(args.email);
    if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) throw new Error("Invalid email");
    await rateLimiter.limit(ctx, "emailLookup", { key: user.id, throws: true });
    const phone = args.phone?.trim().slice(0, MAX_PHONE) || undefined;
    if (email === user.email) throw new Error("Cannot link to yourself");

    const existingLink = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner_email", (q) => q.eq("ownerUserId", user.id).eq("email", email))
      .unique();

    const target = await findAuthUserByEmail(ctx, email);
    if (target && target.id === user.id) throw new Error("Cannot link to yourself");

    if (existingLink) {
      // After a decline the requester has to wait before asking again, so a "no" can't be spammed.
      if (existingLink.status === "declined" && Date.now() - existingLink.updatedAt >= DECLINE_COOLDOWN_MS) {
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

// A repeat of the same position is skipped this long after the last write; later it refreshes updatedAt.
const REPEAT_PUBLISH_MS = 5 * 60_000;

const round5 = (value: number) => Math.round(value * 1e5);
const roundBattery = (value: number | undefined) => (value === undefined ? undefined : Math.round(value * 20));

/**
 * Whether a publish carries nothing new for an active share: the same position (~1 m), battery
 * (5 %), mode and end time, written recently. Skipping it spares every subscriber a re-render.
 */
function isRepeatPublish(
  share: Doc<"locationShares">,
  next: { latitude: number; longitude: number; battery: number | undefined; mode: Doc<"locationShares">["mode"]; endsAt: number | undefined },
  now: number,
) {
  return (
    share.active &&
    now - share.updatedAt < REPEAT_PUBLISH_MS &&
    round5(share.latitude) === round5(next.latitude) &&
    round5(share.longitude) === round5(next.longitude) &&
    roundBattery(share.battery) === roundBattery(next.battery) &&
    share.mode === next.mode &&
    share.endsAt === next.endsAt
  );
}

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
    endsAt: v.optional(v.number()),
  },
  handler: async (ctx, { latitude, longitude, battery, mode, endsAt }) => {
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
    const now = Date.now();
    const safeEndsAt = endsAt !== undefined && endsAt > now ? Math.min(endsAt, now + MAX_SHARE_MS) : undefined;

    const acceptedLinks = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();

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
      if (existing && isRepeatPublish(existing, { latitude, longitude, battery: safeBattery, mode, endsAt: safeEndsAt }, now)) {
        continue;
      }
      if (existing) {
        await ctx.db.patch(existing._id, {
          latitude,
          longitude,
          battery: safeBattery,
          mode,
          endsAt: safeEndsAt,
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
          endsAt: safeEndsAt,
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
    const link = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .filter((q) => q.and(q.eq(q.field("linkedUserId"), recipientUserId), q.eq(q.field("status"), "accepted")))
      .first();
    if (!link) throw new Error("Link not found");
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

    // Re-applied whenever the caller's shares change, so a quiet share can linger until then.
    const now = Date.now();
    const shares = (
      await ctx.db
        .query("locationShares")
        .withIndex("by_recipient", (q) => q.eq("recipientUserId", user.id))
        .filter((q) => q.eq(q.field("active"), true))
        .collect()
    )
      .filter((share) => (share.endsAt !== undefined ? share.endsAt > now : share.updatedAt > now - SHARE_STALE_MS))
      .slice(0, 50);

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

    // Only what the app reads, so the result (and every subscriber) stays unchanged on each publish.
    return shares.map((share) => ({
      recipientUserId: share.recipientUserId,
      paused: share.paused ?? false,
    }));
  },
});

async function uniqueCircleCode(ctx: MutationCtx) {
  for (;;) {
    const code = newInviteCode();
    const taken = await ctx.db
      .query("circleInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!taken) return code;
  }
}

async function circleInviteByCode(ctx: QueryCtx, code: string) {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return null;
  return ctx.db
    .query("circleInvites")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
}

async function findLink(ctx: QueryCtx, ownerUserId: string, linkedUserId: string) {
  return ctx.db
    .query("contactLinks")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .filter((q) => q.eq(q.field("linkedUserId"), linkedUserId))
    .first();
}

/**
 * Makes `from`'s link to `to` accepted (so `to` gets `from`'s alerts and can see them), reusing a
 * pending, declined or email-only link, and drops `from`'s app invites to `to`'s email.
 */
async function acceptLinkBetween(ctx: MutationCtx, from: AppUser, to: AppUser) {
  const email = to.email ? normalizeEmail(to.email) : "";
  const existing =
    (await findLink(ctx, from.id, to.id)) ??
    (email
      ? await ctx.db
          .query("contactLinks")
          .withIndex("by_owner_email", (q) => q.eq("ownerUserId", from.id).eq("email", email))
          .first()
      : null);
  const now = Date.now();
  if (existing) {
    if (existing.status !== "accepted" || existing.linkedUserId !== to.id) {
      await ctx.db.patch(existing._id, { status: "accepted", linkedUserId: to.id, updatedAt: now });
    }
  } else {
    await ctx.db.insert("contactLinks", {
      ownerUserId: from.id,
      linkedUserId: to.id,
      name: (to.name || email.split("@")[0] || "NomadSafe").slice(0, MAX_NAME),
      email,
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!email) return;
  const invites = await ctx.db
    .query("pendingInvites")
    .withIndex("by_owner_email", (q) => q.eq("ownerUserId", from.id).eq("email", email))
    .collect();
  for (const invite of invites) await ctx.db.delete(invite._id);
}

/** The caller's reusable circle invite code, made on first use. */
export const circleInviteCode = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("circleInvites")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .first();
    if (existing) return { code: existing.code };
    await rateLimiter.limit(ctx, "circleCode", { key: user.id, throws: true });
    const code = await uniqueCircleCode(ctx);
    await ctx.db.insert("circleInvites", { ownerUserId: user.id, code, createdAt: Date.now() });
    return { code };
  },
});

/** Replaces the caller's circle invite code, so links shared before stop working. */
export const resetCircleInviteCode = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await rateLimiter.limit(ctx, "circleCode", { key: user.id, throws: true });
    const code = await uniqueCircleCode(ctx);
    const existing = await ctx.db
      .query("circleInvites")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
      .first();
    if (existing) await ctx.db.patch(existing._id, { code, createdAt: Date.now() });
    else await ctx.db.insert("circleInvites", { ownerUserId: user.id, code, createdAt: Date.now() });
    return { code };
  },
});

/** What the circle invite screen shows: only the inviter's display name, never their email. */
export const previewCircleInvite = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return { status: "signed_out" as const };
    const invite = await circleInviteByCode(ctx, code);
    if (!invite) return { status: "not_found" as const };
    if (invite.ownerUserId === user.id) return { status: "own" as const };
    const owner = await findAuthUserById(ctx, invite.ownerUserId);
    if (!owner) return { status: "not_found" as const };
    const [toOwner, toMe] = await Promise.all([findLink(ctx, user.id, owner.id), findLink(ctx, owner.id, user.id)]);
    return {
      status: "ok" as const,
      ownerName: owner.name,
      connected: toOwner?.status === "accepted" && toMe?.status === "accepted",
    };
  },
});

/**
 * Joins someone's circle from their invite link: both people end up with accepted links to each
 * other, so each gets the other's SOS and missed-timer alerts and can share their location.
 * Idempotent; earlier requests between the two (pending or declined) are accepted too.
 */
export const joinCircleInvite = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    await rateLimiter.limit(ctx, "circleJoin", { key: user.id, throws: true });
    const invite = await circleInviteByCode(ctx, code);
    if (!invite) throw new Error("Invite not found");
    if (invite.ownerUserId === user.id) throw new Error("Cannot link to yourself");
    const owner = await findAuthUserById(ctx, invite.ownerUserId);
    if (!owner) throw new Error("Invite not found");
    await acceptLinkBetween(ctx, owner, user);
    await acceptLinkBetween(ctx, user, owner);
    return { ownerUserId: owner.id };
  },
});
