import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { tripRecordKindValidator } from "./schema";
import { requireUser } from "./users";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_BATCH = 100;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_MEMBERS = 50;
const PURGE_BATCH = 500;

function newInviteCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

async function uniqueInviteCode(ctx: MutationCtx) {
  for (;;) {
    const code = newInviteCode();
    const taken = await ctx.db
      .query("sharedTrips")
      .withIndex("by_code", (q) => q.eq("inviteCode", code))
      .unique();
    if (!taken) return code;
  }
}

/** Member names identify people on every phone, so they must be unique within a trip. */
function uniqueName(desired: string, taken: string[]) {
  const base = desired.trim().slice(0, 80) || "Traveler";
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

async function membersOf(ctx: QueryCtx, tripId: Id<"sharedTrips">) {
  return ctx.db
    .query("tripMembers")
    .withIndex("by_trip", (q) => q.eq("tripId", tripId))
    .collect();
}

/** The caller's active membership of a trip, or throws. */
async function requireMember(ctx: QueryCtx, tripId: Id<"sharedTrips">, userId: string) {
  const member = await ctx.db
    .query("tripMembers")
    .withIndex("by_trip_user", (q) => q.eq("tripId", tripId).eq("userId", userId))
    .unique();
  if (!member || member.status !== "active") throw new Error("Not a member of this trip");
  return member;
}

async function bumpSeq(ctx: MutationCtx, trip: Doc<"sharedTrips">) {
  const seq = trip.seq + 1;
  await ctx.db.patch(trip._id, { seq });
  return seq;
}

function publicMember(member: Doc<"tripMembers">) {
  return {
    memberId: member.memberId,
    name: member.name,
    role: member.role,
    status: member.status,
    linked: member.userId !== undefined,
  };
}

/** Turns a group trip into a shared one: the caller becomes owner, companions become name-only members. */
export const shareTrip = mutation({
  args: { data: v.any(), dataUpdatedAt: v.number(), ownerName: v.string(), companions: v.array(v.string()) },
  handler: async (ctx, { data, dataUpdatedAt, ownerName, companions }) => {
    const user = await requireUser(ctx);
    if (companions.length >= MAX_MEMBERS) throw new Error("Too many members");
    const now = Date.now();
    const tripId = await ctx.db.insert("sharedTrips", {
      ownerUserId: user.id,
      inviteCode: await uniqueInviteCode(ctx),
      data,
      dataUpdatedAt,
      seq: 1,
      createdAt: now,
    });
    // Companion names are kept exactly as typed, since the owner's expenses already refer to them;
    // on a clash it's the owner who gets a suffix (on their own phone they're always "You").
    const names: string[] = [];
    for (const companion of companions) {
      const name = uniqueName(companion, names);
      names.push(name);
      await ctx.db.insert("tripMembers", {
        tripId,
        memberId: crypto.randomUUID(),
        name,
        role: "member",
        status: "active",
        archived: false,
        muted: false,
        joinedAt: now,
      });
    }
    await ctx.db.insert("tripMembers", {
      tripId,
      memberId: crypto.randomUUID(),
      name: uniqueName(ownerName || user.name, names),
      userId: user.id,
      role: "owner",
      status: "active",
      archived: false,
      muted: false,
      joinedAt: now,
    });
    return { tripId };
  },
});

/** Every shared trip the caller belongs to, with members; reactive so phones learn about changes live. */
export const myTrips = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const memberships = await ctx.db
      .query("tripMembers")
      .withIndex("by_user", (q) => q.eq("userId", user.id))
      .collect();
    const trips = [];
    for (const me of memberships) {
      if (me.status !== "active") continue;
      const trip = await ctx.db.get(me.tripId);
      if (!trip) continue;
      const members = await membersOf(ctx, trip._id);
      trips.push({
        tripId: trip._id,
        seq: trip.seq,
        data: trip.data,
        dataUpdatedAt: trip.dataUpdatedAt,
        inviteCode: trip.inviteCode,
        myMemberId: me.memberId,
        role: me.role,
        archived: me.archived,
        muted: me.muted,
        // Removed members are still listed so their past expenses keep showing their name.
        members: members.map(publicMember),
      });
    }
    return trips;
  },
});

/** What the join screen shows for an invite code. */
export const previewInvite = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    const trip = await ctx.db
      .query("sharedTrips")
      .withIndex("by_code", (q) => q.eq("inviteCode", code.trim().toUpperCase()))
      .unique();
    if (!trip) return null;
    const members = await membersOf(ctx, trip._id);
    const owner = members.find((member) => member.role === "owner");
    const data = trip.data as { name?: string; startDate?: string; endDate?: string; destinations?: string[] };
    return {
      tripId: trip._id,
      name: data.name ?? "",
      startDate: data.startDate ?? "",
      endDate: data.endDate ?? "",
      destinations: data.destinations ?? [],
      ownerName: owner?.name ?? "",
      alreadyMember: members.some((member) => member.userId === user.id && member.status === "active"),
      unclaimed: members
        .filter((member) => member.userId === undefined && member.status === "active")
        .map((member) => ({ memberId: member.memberId, name: member.name })),
      memberCount: members.filter((member) => member.status === "active").length,
    };
  },
});

/** Joins via invite code, either as one of the name-only companions or as a new member. */
export const joinTrip = mutation({
  args: { code: v.string(), claimMemberId: v.optional(v.string()), name: v.string() },
  handler: async (ctx, { code, claimMemberId, name }) => {
    const user = await requireUser(ctx);
    const trip = await ctx.db
      .query("sharedTrips")
      .withIndex("by_code", (q) => q.eq("inviteCode", code.trim().toUpperCase()))
      .unique();
    if (!trip) throw new Error("Invite not found");
    const members = await membersOf(ctx, trip._id);
    const existing = members.find((member) => member.userId === user.id);
    if (existing?.status === "active") return { tripId: trip._id };
    if (existing?.status === "removed") throw new Error("Removed from this trip");
    if (members.filter((member) => member.status === "active").length >= MAX_MEMBERS) throw new Error("Trip is full");

    const claim = claimMemberId
      ? members.find((member) => member.memberId === claimMemberId && member.userId === undefined && member.status === "active")
      : undefined;
    if (claim) {
      await ctx.db.patch(claim._id, { userId: user.id, joinedAt: Date.now() });
    } else if (existing) {
      // Rejoining after leaving keeps their old member id, so past splits stay theirs.
      await ctx.db.patch(existing._id, { status: "active", archived: false, joinedAt: Date.now() });
    } else {
      await ctx.db.insert("tripMembers", {
        tripId: trip._id,
        memberId: crypto.randomUUID(),
        name: uniqueName(name || user.name, members.map((member) => member.name)),
        userId: user.id,
        role: "member",
        status: "active",
        archived: false,
        muted: false,
        joinedAt: Date.now(),
      });
    }
    await bumpSeq(ctx, trip);
    return { tripId: trip._id };
  },
});

/** Trip details edited by any member; last write wins. */
export const updateTripDetails = mutation({
  args: { tripId: v.id("sharedTrips"), data: v.any(), dataUpdatedAt: v.number() },
  handler: async (ctx, { tripId, data, dataUpdatedAt }) => {
    const user = await requireUser(ctx);
    await requireMember(ctx, tripId, user.id);
    const trip = await ctx.db.get(tripId);
    if (!trip || trip.dataUpdatedAt > dataUpdatedAt) return;
    await ctx.db.patch(tripId, { data, dataUpdatedAt, seq: trip.seq + 1 });
  },
});

/** Adds name-only members for companions typed into the trip form. */
export const addCompanions = mutation({
  args: { tripId: v.id("sharedTrips"), names: v.array(v.string()) },
  handler: async (ctx, { tripId, names }) => {
    const user = await requireUser(ctx);
    await requireMember(ctx, tripId, user.id);
    const trip = await ctx.db.get(tripId);
    if (!trip) return;
    const members = await membersOf(ctx, tripId);
    const taken = members.map((member) => member.name);
    let added = 0;
    for (const raw of names) {
      if (members.length + added >= MAX_MEMBERS) break;
      const same = members.find((member) => member.name.toLowerCase() === raw.trim().toLowerCase());
      if (same) {
        if (same.status === "removed" && same.userId === undefined) {
          await ctx.db.patch(same._id, { status: "active" });
          added += 1;
        }
        continue;
      }
      const name = uniqueName(raw, taken);
      taken.push(name);
      added += 1;
      await ctx.db.insert("tripMembers", {
        tripId,
        memberId: crypto.randomUUID(),
        name,
        role: "member",
        status: "active",
        archived: false,
        muted: false,
        joinedAt: Date.now(),
      });
    }
    if (added > 0) await bumpSeq(ctx, trip);
  },
});

/** Stores a batch of trip records from any member and notifies the others about money changes. */
export const pushRecords = mutation({
  args: {
    tripId: v.id("sharedTrips"),
    records: v.array(
      v.object({
        kind: tripRecordKindValidator,
        clientId: v.string(),
        data: v.optional(v.any()),
        deleted: v.boolean(),
        updatedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, { tripId, records }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, tripId, user.id);
    const trip = await ctx.db.get(tripId);
    if (!trip) throw new Error("Trip not found");
    if (records.length > MAX_BATCH) throw new Error("Too many records");

    let seq = trip.seq;
    let rejectedSeq: number | null = null;
    const changes: { kind: "expense" | "settlement"; action: "added" | "updated" | "deleted"; title: string; amount: number; currency: string }[] = [];
    for (const record of records) {
      if (!record.deleted && JSON.stringify(record.data ?? null).length > MAX_RECORD_BYTES) throw new Error("Record too large");
      const existing = await ctx.db
        .query("tripRecords")
        .withIndex("by_trip_record", (q) => q.eq("tripId", tripId).eq("kind", record.kind).eq("clientId", record.clientId))
        .unique();
      if (existing && existing.updatedAt > record.updatedAt) {
        rejectedSeq = Math.min(rejectedSeq ?? existing.seq, existing.seq);
        continue;
      }
      if (existing?.deleted && record.deleted) continue;

      seq += 1;
      const doc = {
        tripId,
        kind: record.kind,
        clientId: record.clientId,
        data: record.deleted ? undefined : record.data,
        deleted: record.deleted,
        updatedAt: record.updatedAt,
        updatedBy: user.id,
        seq,
      };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("tripRecords", doc);

      if (record.kind !== "event") {
        const source = (record.deleted ? existing?.data : record.data) as { merchant?: string; amount?: number; currency?: string } | undefined;
        changes.push({
          kind: record.kind,
          action: record.deleted ? "deleted" : existing && !existing.deleted ? "updated" : "added",
          title: source?.merchant ?? "",
          amount: source?.amount ?? 0,
          currency: source?.currency ?? "",
        });
      }
    }
    if (seq !== trip.seq) await ctx.db.patch(tripId, { seq });
    if (changes.length > 0) {
      await ctx.scheduler.runAfter(0, internal.tripNotifications.notifyTrip, { tripId, actorMemberId: me.memberId, changes });
    }
    // The client re-pulls from just before the oldest rejected record to adopt the newer version.
    return { seq, rejectedSeq };
  },
});

/** A trip's records written after `after`, oldest first. */
export const pullRecords = query({
  args: { tripId: v.id("sharedTrips"), after: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { tripId, after, paginationOpts }) => {
    const user = await requireUser(ctx);
    await requireMember(ctx, tripId, user.id);
    const page = await ctx.db
      .query("tripRecords")
      .withIndex("by_trip_seq", (q) => q.eq("tripId", tripId).gt("seq", after))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((doc) => ({
        kind: doc.kind,
        clientId: doc.clientId,
        data: doc.data,
        deleted: doc.deleted,
        updatedAt: doc.updatedAt,
        seq: doc.seq,
      })),
    };
  },
});

export const setPreferences = mutation({
  args: { tripId: v.id("sharedTrips"), archived: v.optional(v.boolean()), muted: v.optional(v.boolean()) },
  handler: async (ctx, { tripId, archived, muted }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, tripId, user.id);
    await ctx.db.patch(me._id, {
      ...(archived === undefined ? {} : { archived }),
      ...(muted === undefined ? {} : { muted }),
    });
  },
});

/** A member leaves; the app only offers this once they're settled up. Owners delete instead. */
export const leaveTrip = mutation({
  args: { tripId: v.id("sharedTrips") },
  handler: async (ctx, { tripId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, tripId, user.id);
    if (me.role === "owner") throw new Error("The owner can't leave");
    await ctx.db.patch(me._id, { status: "left" });
    const trip = await ctx.db.get(tripId);
    if (trip) await bumpSeq(ctx, trip);
  },
});

/** Owner removes someone; their past expenses stay on the trip under their name. */
export const removeMember = mutation({
  args: { tripId: v.id("sharedTrips"), memberId: v.string() },
  handler: async (ctx, { tripId, memberId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, tripId, user.id);
    if (me.role !== "owner") throw new Error("Only the owner can remove people");
    const members = await membersOf(ctx, tripId);
    const target = members.find((member) => member.memberId === memberId);
    if (!target || target.role === "owner") throw new Error("Member not found");
    await ctx.db.patch(target._id, { status: "removed" });
    const trip = await ctx.db.get(tripId);
    if (trip) await bumpSeq(ctx, trip);
  },
});

/** Owner invalidates the current link and gets a new one. */
export const resetInviteCode = mutation({
  args: { tripId: v.id("sharedTrips") },
  handler: async (ctx, { tripId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, tripId, user.id);
    if (me.role !== "owner") throw new Error("Only the owner can reset the link");
    const trip = await ctx.db.get(tripId);
    if (!trip) return;
    await ctx.db.patch(tripId, { inviteCode: await uniqueInviteCode(ctx), seq: trip.seq + 1 });
  },
});

/** Owner deletes the trip; only allowed once no one else who joined is still on it. */
export const deleteSharedTrip = mutation({
  args: { tripId: v.id("sharedTrips") },
  handler: async (ctx, { tripId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, tripId, user.id);
    if (me.role !== "owner") throw new Error("Only the owner can delete the trip");
    const members = await membersOf(ctx, tripId);
    if (members.some((member) => member.userId && member.userId !== user.id && member.status === "active")) {
      throw new Error("Remove everyone else first");
    }
    await purgeTrip(ctx, tripId);
  },
});

async function purgeTrip(ctx: MutationCtx, tripId: Id<"sharedTrips">) {
  for (const member of await membersOf(ctx, tripId)) await ctx.db.delete(member._id);
  await ctx.db.delete(tripId);
  await ctx.scheduler.runAfter(0, internal.groupTrips.purgeTripRecords, { tripId });
}

export const purgeTripRecords = internalMutation({
  args: { tripId: v.id("sharedTrips") },
  handler: async (ctx, { tripId }) => {
    const batch = await ctx.db
      .query("tripRecords")
      .withIndex("by_trip_seq", (q) => q.eq("tripId", tripId))
      .take(PURGE_BATCH);
    for (const doc of batch) await ctx.db.delete(doc._id);
    if (batch.length === PURGE_BATCH) await ctx.scheduler.runAfter(0, internal.groupTrips.purgeTripRecords, { tripId });
  },
});

/**
 * Account deletion: the user leaves every shared trip. Trips they own pass to the longest-standing
 * member who joined; trips with no one else left are deleted.
 */
export async function removeUserFromTrips(ctx: MutationCtx, userId: string) {
  const memberships = await ctx.db
    .query("tripMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const me of memberships) {
    const trip = await ctx.db.get(me.tripId);
    if (!trip) continue;
    const others = (await membersOf(ctx, me.tripId))
      .filter((member) => member.userId && member.userId !== userId && member.status === "active")
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (me.role === "owner") {
      if (others.length === 0) {
        await purgeTrip(ctx, me.tripId);
        continue;
      }
      await ctx.db.patch(others[0]._id, { role: "owner" });
      await ctx.db.patch(trip._id, { ownerUserId: others[0].userId! });
    }
    await ctx.db.patch(me._id, { userId: undefined, role: "member", status: "left" });
    await bumpSeq(ctx, trip);
  }
}

/** Who to notify about a change, with their tokens; used by the push action. */
export const notificationTargets = internalQuery({
  args: { tripId: v.id("sharedTrips"), actorMemberId: v.string() },
  handler: async (ctx, { tripId, actorMemberId }) => {
    const trip = await ctx.db.get(tripId);
    if (!trip) return null;
    const members = await membersOf(ctx, tripId);
    const actor = members.find((member) => member.memberId === actorMemberId);
    const targets: { token: string; locale: string }[] = [];
    for (const member of members) {
      if (!member.userId || member.memberId === actorMemberId || member.status !== "active" || member.muted) continue;
      const tokens = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", member.userId!))
        .collect();
      targets.push(...tokens.map((token) => ({ token: token.token, locale: token.locale })));
    }
    return { tripName: (trip.data as { name?: string }).name ?? "", actorName: actor?.name ?? "", targets };
  },
});
