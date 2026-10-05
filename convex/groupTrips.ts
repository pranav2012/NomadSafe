import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { tripRecordKindValidator } from "./schema";
import { MAX_CLIENT_ID } from "./sync";
import { assertMaxLength, clampClientTime, newInviteCode, normalizeInviteCode, stripEmailNote } from "./securityRules";
import { NOTIFY_TITLE_CHARS, queueTripNotification } from "./tripNotifications";
import { requireUser } from "./users";

const MAX_BATCH = 100;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_TRIP_DATA_BYTES = 64 * 1024;
const MAX_MEMBERS = 50;
const MAX_NAME = 80;
const MAX_RECORDS_PER_TRIP = 10_000;
const MAX_OWNED_TRIPS = 50;
const MAX_JOINED_TRIPS = 200;
const PURGE_BATCH = 500;

const rateLimiter = new RateLimiter(components.rateLimiter, {
  tripShare: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
  tripDetails: { kind: "token bucket", rate: 300, period: HOUR, capacity: 60 },
  tripRecordsPush: { kind: "token bucket", rate: 600, period: HOUR, capacity: 200 },
  // Joining is a handful of taps; this stops scripted guessing of invite codes.
  tripJoin: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
});

function assertTripData(data: unknown) {
  if (JSON.stringify(data ?? null).length > MAX_TRIP_DATA_BYTES) throw new Error("Trip details too large");
}

function assertNames(names: string[]) {
  if (names.length > MAX_MEMBERS) throw new Error("Too many members");
  for (const name of names) assertMaxLength(name, MAX_NAME, "Name");
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
    assertNames(companions);
    assertMaxLength(ownerName, MAX_NAME, "Name");
    assertTripData(data);
    await rateLimiter.limit(ctx, "tripShare", { key: user.id, throws: true });
    const memberships = await ctx.db
      .query("tripMembers")
      .withIndex("by_user", (q) => q.eq("userId", user.id))
      .collect();
    if (memberships.filter((member) => member.role === "owner").length >= MAX_OWNED_TRIPS) {
      throw new Error("Too many shared trips");
    }
    const now = Date.now();
    const tripId = await ctx.db.insert("sharedTrips", {
      ownerUserId: user.id,
      inviteCode: await uniqueInviteCode(ctx),
      data,
      dataUpdatedAt: clampClientTime(dataUpdatedAt, now),
      seq: 1,
      createdAt: now,
      recordCount: 0,
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
    const inviteCode = normalizeInviteCode(code);
    if (!inviteCode) return null;
    const trip = await ctx.db
      .query("sharedTrips")
      .withIndex("by_code", (q) => q.eq("inviteCode", inviteCode))
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
    assertMaxLength(name, MAX_NAME, "Name");
    await rateLimiter.limit(ctx, "tripJoin", { key: user.id, throws: true });
    const inviteCode = normalizeInviteCode(code);
    const trip = inviteCode
      ? await ctx.db
          .query("sharedTrips")
          .withIndex("by_code", (q) => q.eq("inviteCode", inviteCode))
          .unique()
      : null;
    if (!trip) throw new Error("Invite not found");
    const members = await membersOf(ctx, trip._id);
    const existing = members.find((member) => member.userId === user.id);
    if (existing?.status === "active") return { tripId: trip._id };
    if (existing?.status === "removed") throw new Error("Removed from this trip");
    if (members.filter((member) => member.status === "active").length >= MAX_MEMBERS) throw new Error("Trip is full");
    if (!existing) {
      const joined = await ctx.db
        .query("tripMembers")
        .withIndex("by_user", (q) => q.eq("userId", user.id))
        .collect();
      if (joined.filter((member) => member.status === "active").length >= MAX_JOINED_TRIPS) throw new Error("Too many shared trips");
    }

    // Someone who left and rejoins always gets their old row back, so they never hold two memberships.
    const claim = claimMemberId && !existing
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
    assertTripData(data);
    await requireMember(ctx, tripId, user.id);
    await rateLimiter.limit(ctx, "tripDetails", { key: user.id, throws: true });
    const trip = await ctx.db.get(tripId);
    const updatedAt = clampClientTime(dataUpdatedAt, Date.now());
    if (!trip || trip.dataUpdatedAt > updatedAt) return;
    await ctx.db.patch(tripId, { data, dataUpdatedAt: updatedAt, seq: trip.seq + 1 });
  },
});

/** Adds name-only members for companions typed into the trip form. */
export const addCompanions = mutation({
  args: { tripId: v.id("sharedTrips"), names: v.array(v.string()) },
  handler: async (ctx, { tripId, names }) => {
    const user = await requireUser(ctx);
    assertNames(names);
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
    for (const record of records) assertMaxLength(record.clientId, MAX_CLIENT_ID, "clientId");
    await rateLimiter.limit(ctx, "tripRecordsPush", { key: user.id, throws: true });

    const now = Date.now();
    let seq = trip.seq;
    let recordCount = trip.recordCount ?? 0;
    let rejectedSeq: number | null = null;
    const changes: { kind: "expense" | "settlement"; action: "added" | "updated" | "deleted"; title: string; amount: number; currency: string }[] = [];
    for (const record of records) {
      if (!record.deleted && JSON.stringify(record.data ?? null).length > MAX_RECORD_BYTES) throw new Error("Record too large");
      const existing = await ctx.db
        .query("tripRecords")
        .withIndex("by_trip_record", (q) => q.eq("tripId", tripId).eq("kind", record.kind).eq("clientId", record.clientId))
        .unique();
      const updatedAt = clampClientTime(record.updatedAt, now);
      if (existing && existing.updatedAt > updatedAt) {
        rejectedSeq = Math.min(rejectedSeq ?? existing.seq, existing.seq);
        continue;
      }
      if (existing?.deleted && record.deleted) continue;
      if (!existing) {
        if (recordCount >= MAX_RECORDS_PER_TRIP) throw new Error("Trip is full");
        recordCount += 1;
      }

      seq += 1;
      const doc = {
        tripId,
        kind: record.kind,
        clientId: record.clientId,
        data: record.deleted ? undefined : stripEmailNote(record.data),
        deleted: record.deleted,
        updatedAt,
        updatedBy: user.id,
        seq,
      };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("tripRecords", doc);

      if (record.kind !== "event") {
        const source = (record.deleted ? existing?.data : record.data) as { merchant?: unknown; amount?: unknown; currency?: unknown } | undefined;
        changes.push({
          kind: record.kind,
          action: record.deleted ? "deleted" : existing && !existing.deleted ? "updated" : "added",
          title: typeof source?.merchant === "string" ? source.merchant.slice(0, NOTIFY_TITLE_CHARS) : "",
          amount: typeof source?.amount === "number" && Number.isFinite(source.amount) ? source.amount : 0,
          currency: typeof source?.currency === "string" ? source.currency.slice(0, 8) : "",
        });
      }
    }
    if (seq !== trip.seq) await ctx.db.patch(tripId, { seq, recordCount });
    if (changes.length > 0) await queueTripNotification(ctx, tripId, me.memberId, changes);
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
  const notifyRows = await ctx.db
    .query("tripNotifyState")
    .withIndex("by_trip_actor", (q) => q.eq("tripId", tripId))
    .collect();
  for (const row of notifyRows) await ctx.db.delete(row._id);
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
    await ctx.scheduler.runAfter(0, internal.groupTrips.clearRecordAuthor, { tripId: me.tripId, userId, cursor: null });
  }
}

/** Account deletion: drops the deleted user's id from the records they last edited on a trip that lives on. */
export const clearRecordAuthor = internalMutation({
  args: { tripId: v.id("sharedTrips"), userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { tripId, userId, cursor }) => {
    const page = await ctx.db
      .query("tripRecords")
      .withIndex("by_trip_seq", (q) => q.eq("tripId", tripId))
      .paginate({ cursor, numItems: PURGE_BATCH });
    for (const doc of page.page) {
      if (doc.updatedBy === userId) await ctx.db.patch(doc._id, { updatedBy: undefined });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.groupTrips.clearRecordAuthor, { tripId, userId, cursor: page.continueCursor });
    }
  },
});

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
    const tripName = (trip.data as { name?: unknown } | null)?.name;
    return { tripName: typeof tripName === "string" ? tripName : "", actorName: actor?.name ?? "", targets };
  },
});
