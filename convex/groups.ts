import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { groupRecordKindValidator } from "./schema";
import { MAX_CLIENT_ID } from "./sync";
import { assertMaxLength, clampClientTime, newInviteCode, normalizeInviteCode, stripEmailNote } from "./securityRules";
import { NOTIFY_TITLE_CHARS, queueGroupNotification } from "./pushNotifications";
import { getAuthenticatedUser, requireUser } from "./users";

const MAX_BATCH = 100;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_GROUP_DATA_BYTES = 64 * 1024;
const MAX_MEMBERS = 50;
const MAX_NAME = 80;
const MAX_RECORDS_PER_GROUP = 10_000;
const MAX_OWNED_GROUPS = 50;
const MAX_JOINED_GROUPS = 200;
const PURGE_BATCH = 500;

const rateLimiter = new RateLimiter(components.rateLimiter, {
  groupShare: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
  groupDetails: { kind: "token bucket", rate: 300, period: HOUR, capacity: 60 },
  groupRecordsPush: { kind: "token bucket", rate: 600, period: HOUR, capacity: 200 },
  // Joining is a handful of taps; this stops scripted guessing of invite codes.
  groupJoin: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
  // One "can you send me the ticket?" per item per person every half hour.
  ticketAsk: { kind: "fixed window", rate: 1, period: 30 * MINUTE },
});

function assertGroupData(data: unknown) {
  if (JSON.stringify(data ?? null).length > MAX_GROUP_DATA_BYTES) throw new Error("Group details too large");
}

function assertNames(names: string[]) {
  if (names.length > MAX_MEMBERS) throw new Error("Too many members");
  for (const name of names) assertMaxLength(name, MAX_NAME, "Name");
}

async function uniqueInviteCode(ctx: MutationCtx) {
  for (;;) {
    const code = newInviteCode();
    const taken = await ctx.db
      .query("sharedGroups")
      .withIndex("by_code", (q) => q.eq("inviteCode", code))
      .unique();
    if (!taken) return code;
  }
}

/** Member names identify people on every phone, so they must be unique within a group. */
function uniqueName(desired: string, taken: string[]) {
  const base = desired.trim().slice(0, 80) || "Traveler";
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

async function membersOf(ctx: QueryCtx, groupId: Id<"sharedGroups">) {
  return ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
}

/** The caller's active membership of a group, or throws. */
async function requireMember(ctx: QueryCtx, groupId: Id<"sharedGroups">, userId: string) {
  const member = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", userId))
    .unique();
  if (!member || member.status !== "active") throw new Error("Not a member of this group");
  return member;
}

async function bumpSeq(ctx: MutationCtx, group: Doc<"sharedGroups">) {
  const seq = group.seq + 1;
  await ctx.db.patch(group._id, { seq });
  return seq;
}

function publicMember(member: Doc<"groupMembers">) {
  return {
    memberId: member.memberId,
    name: member.name,
    role: member.role,
    status: member.status,
    linked: member.userId !== undefined,
  };
}

/**
 * Shares a trip or group: the caller becomes owner and companions become name-only members. With
 * `fromGroupId` (a shared group the caller is in), the people who joined that group are added
 * directly, linked to their accounts, and told by push.
 */
export const shareGroup = mutation({
  args: {
    data: v.any(),
    dataUpdatedAt: v.number(),
    ownerName: v.string(),
    companions: v.array(v.string()),
    fromGroupId: v.optional(v.id("sharedGroups")),
  },
  handler: async (ctx, { data, dataUpdatedAt, ownerName, companions, fromGroupId }) => {
    const user = await requireUser(ctx);
    if (companions.length >= MAX_MEMBERS) throw new Error("Too many members");
    assertNames(companions);
    assertMaxLength(ownerName, MAX_NAME, "Name");
    assertGroupData(data);
    await rateLimiter.limit(ctx, "groupShare", { key: user.id, throws: true });
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", user.id))
      .collect();
    if (memberships.filter((member) => member.role === "owner").length >= MAX_OWNED_GROUPS) {
      throw new Error("Too many shared groups");
    }
    const now = Date.now();
    const groupId = await ctx.db.insert("sharedGroups", {
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
    const source = fromGroupId ? await requireMember(ctx, fromGroupId, user.id).then(() => membersOf(ctx, fromGroupId)) : [];
    const linkable = source.filter((member) => member.userId && member.userId !== user.id && member.status === "active");
    const names: string[] = [];
    const added: string[] = [];
    for (const companion of companions) {
      const name = uniqueName(companion, names);
      names.push(name);
      const from = linkable.find((member) => member.name.trim().toLowerCase() === companion.trim().toLowerCase());
      const linked = from?.userId && (await canJoinMore(ctx, from.userId)) ? from.userId : undefined;
      const memberId = crypto.randomUUID();
      if (linked) added.push(memberId);
      await ctx.db.insert("groupMembers", {
        groupId,
        memberId,
        name,
        ...(linked ? { userId: linked } : {}),
        role: "member",
        status: "active",
        archived: false,
        muted: false,
        joinedAt: now,
      });
    }
    await ctx.db.insert("groupMembers", {
      groupId,
      memberId: crypto.randomUUID(),
      name: uniqueName(ownerName || user.name, names),
      userId: user.id,
      role: "owner",
      status: "active",
      archived: false,
      muted: false,
      joinedAt: now,
    });
    if (added.length > 0) {
      const owner = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", user.id))
        .unique();
      await ctx.scheduler.runAfter(0, internal.pushNotifications.notifyAddedToGroup, {
        groupId,
        actorMemberId: owner?.memberId ?? "",
        memberIds: added,
      });
    }
    return { groupId };
  },
});

async function canJoinMore(ctx: QueryCtx, userId: string) {
  const joined = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return joined.filter((member) => member.status === "active").length < MAX_JOINED_GROUPS;
}

/**
 * Every shared group the caller belongs to, with members; reactive so phones learn about changes live.
 * Null (not an empty list, which would read as "left every group") while the client is between auth
 * tokens, e.g. reconnecting after a deploy.
 */
export const myGroups = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", user.id))
      .collect();
    const groups = [];
    for (const me of memberships) {
      if (me.status !== "active") continue;
      const group = await ctx.db.get(me.groupId);
      if (!group) continue;
      const members = await membersOf(ctx, group._id);
      groups.push({
        groupId: group._id,
        seq: group.seq,
        data: group.data,
        dataUpdatedAt: group.dataUpdatedAt,
        inviteCode: group.inviteCode,
        myMemberId: me.memberId,
        role: me.role,
        archived: me.archived,
        muted: me.muted,
        // Removed members are still listed so their past expenses keep showing their name.
        members: members.map(publicMember),
      });
    }
    return groups;
  },
});

/** What the join screen shows for an invite code. */
export const previewInvite = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    const inviteCode = normalizeInviteCode(code);
    if (!inviteCode) return null;
    const group = await ctx.db
      .query("sharedGroups")
      .withIndex("by_code", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    if (!group) return null;
    const members = await membersOf(ctx, group._id);
    const owner = members.find((member) => member.role === "owner");
    const data = group.data as { kind?: string; emoji?: string; name?: string; startDate?: string; endDate?: string; destinations?: string[]; month?: string };
    return {
      groupId: group._id,
      kind: data.kind === "group" ? ("group" as const) : data.kind === "planned" ? ("planned" as const) : ("trip" as const),
      month: data.month ?? "",
      emoji: data.emoji ?? "",
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
export const joinGroup = mutation({
  args: { code: v.string(), claimMemberId: v.optional(v.string()), name: v.string() },
  handler: async (ctx, { code, claimMemberId, name }) => {
    const user = await requireUser(ctx);
    assertMaxLength(name, MAX_NAME, "Name");
    await rateLimiter.limit(ctx, "groupJoin", { key: user.id, throws: true });
    const inviteCode = normalizeInviteCode(code);
    const group = inviteCode
      ? await ctx.db
          .query("sharedGroups")
          .withIndex("by_code", (q) => q.eq("inviteCode", inviteCode))
          .unique()
      : null;
    if (!group) throw new Error("Invite not found");
    const members = await membersOf(ctx, group._id);
    const existing = members.find((member) => member.userId === user.id);
    if (existing?.status === "active") return { groupId: group._id };
    if (existing?.status === "removed") throw new Error("Removed from this group");
    if (members.filter((member) => member.status === "active").length >= MAX_MEMBERS) throw new Error("Group is full");
    if (!existing) {
      const joined = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", user.id))
        .collect();
      if (joined.filter((member) => member.status === "active").length >= MAX_JOINED_GROUPS) throw new Error("Too many shared groups");
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
      await ctx.db.insert("groupMembers", {
        groupId: group._id,
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
    await bumpSeq(ctx, group);
    return { groupId: group._id };
  },
});

/**
 * Group details edited by any member; last write wins. Only the owner confirms a planned trip (its
 * details change from `kind: "planned"` to a trip's), and the others hear about it.
 */
export const updateGroupDetails = mutation({
  args: { groupId: v.id("sharedGroups"), data: v.any(), dataUpdatedAt: v.number() },
  handler: async (ctx, { groupId, data, dataUpdatedAt }) => {
    const user = await requireUser(ctx);
    assertGroupData(data);
    const me = await requireMember(ctx, groupId, user.id);
    await rateLimiter.limit(ctx, "groupDetails", { key: user.id, throws: true });
    const group = await ctx.db.get(groupId);
    const updatedAt = clampClientTime(dataUpdatedAt, Date.now());
    if (!group || group.dataUpdatedAt > updatedAt) return;
    const wasPlanned = isPlannedData(group.data);
    const confirmed = wasPlanned && !isPlannedData(data);
    if (confirmed && me.role !== "owner") throw new Error("Only the owner can confirm the trip");
    if (!wasPlanned && isPlannedData(data)) throw new Error("A trip can't go back to planning");
    await ctx.db.patch(groupId, { data, dataUpdatedAt: updatedAt, seq: group.seq + 1 });
    const dates = data as { startDate?: unknown; endDate?: unknown };
    if (confirmed && typeof dates.startDate === "string" && typeof dates.endDate === "string") {
      await ctx.scheduler.runAfter(0, internal.pushNotifications.notifyConfirmed, {
        groupId,
        actorMemberId: me.memberId,
        startDate: dates.startDate.slice(0, 10),
        endDate: dates.endDate.slice(0, 10),
      });
    }
  },
});

function isPlannedData(data: unknown): boolean {
  return (data as { kind?: unknown } | null)?.kind === "planned";
}

/** Adds name-only members for companions typed into the group form. */
export const addCompanions = mutation({
  args: { groupId: v.id("sharedGroups"), names: v.array(v.string()) },
  handler: async (ctx, { groupId, names }) => {
    const user = await requireUser(ctx);
    assertNames(names);
    await requireMember(ctx, groupId, user.id);
    const group = await ctx.db.get(groupId);
    if (!group) return;
    const members = await membersOf(ctx, groupId);
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
      await ctx.db.insert("groupMembers", {
        groupId,
        memberId: crypto.randomUUID(),
        name,
        role: "member",
        status: "active",
        archived: false,
        muted: false,
        joinedAt: Date.now(),
      });
    }
    if (added > 0) await bumpSeq(ctx, group);
  },
});

/** Stores a batch of group records from any member and notifies the others about money changes. */
export const pushRecords = mutation({
  args: {
    groupId: v.id("sharedGroups"),
    records: v.array(
      v.object({
        kind: groupRecordKindValidator,
        clientId: v.string(),
        data: v.optional(v.any()),
        deleted: v.boolean(),
        updatedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, { groupId, records }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, groupId, user.id);
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (records.length > MAX_BATCH) throw new Error("Too many records");
    for (const record of records) assertMaxLength(record.clientId, MAX_CLIENT_ID, "clientId");
    await rateLimiter.limit(ctx, "groupRecordsPush", { key: user.id, throws: true });

    const now = Date.now();
    let seq = group.seq;
    let recordCount = group.recordCount ?? 0;
    let rejectedSeq: number | null = null;
    const changes: { kind: "expense" | "settlement"; action: "added" | "updated" | "deleted"; title: string; amount: number; currency: string }[] = [];
    // Ideas newly saved to a planned trip; they're announced separately, a few hours at a time.
    const ideas: { kind: "idea"; action: "added"; title: string; amount: number; currency: string }[] = [];
    const planned = isPlannedData(group.data);
    for (const record of records) {
      if (!record.deleted && JSON.stringify(record.data ?? null).length > MAX_RECORD_BYTES) throw new Error("Record too large");
      const existing = await ctx.db
        .query("groupRecords")
        .withIndex("by_group_record", (q) => q.eq("groupId", groupId).eq("kind", record.kind).eq("clientId", record.clientId))
        .unique();
      const updatedAt = clampClientTime(record.updatedAt, now);
      if (existing && existing.updatedAt > updatedAt) {
        rejectedSeq = Math.min(rejectedSeq ?? existing.seq, existing.seq);
        continue;
      }
      if (existing?.deleted && record.deleted) continue;
      if (!existing) {
        if (recordCount >= MAX_RECORDS_PER_GROUP) throw new Error("Group is full");
        recordCount += 1;
      }

      seq += 1;
      const doc = {
        groupId,
        kind: record.kind,
        clientId: record.clientId,
        data: record.deleted ? undefined : stripEmailNote(record.data),
        deleted: record.deleted,
        updatedAt,
        updatedBy: user.id,
        seq,
      };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("groupRecords", doc);

      const idea = record.data as { timing?: unknown; title?: unknown } | undefined;
      if (planned && record.kind === "event" && !record.deleted && (!existing || existing.deleted) && idea?.timing === "wishlist") {
        ideas.push({ kind: "idea", action: "added", title: typeof idea.title === "string" ? idea.title.slice(0, NOTIFY_TITLE_CHARS) : "", amount: 0, currency: "" });
      }
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
    if (seq !== group.seq) await ctx.db.patch(groupId, { seq, recordCount });
    if (changes.length > 0) await queueGroupNotification(ctx, groupId, me.memberId, changes);
    if (ideas.length > 0) await queueGroupNotification(ctx, groupId, me.memberId, ideas);
    // The client re-pulls from just before the oldest rejected record to adopt the newer version.
    return { seq, rejectedSeq };
  },
});

/** A group's records written after `after`, oldest first. */
export const pullRecords = query({
  args: { groupId: v.id("sharedGroups"), after: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { groupId, after, paginationOpts }) => {
    const user = await requireUser(ctx);
    await requireMember(ctx, groupId, user.id);
    const page = await ctx.db
      .query("groupRecords")
      .withIndex("by_group_seq", (q) => q.eq("groupId", groupId).gt("seq", after))
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
  args: { groupId: v.id("sharedGroups"), archived: v.optional(v.boolean()), muted: v.optional(v.boolean()) },
  handler: async (ctx, { groupId, archived, muted }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, groupId, user.id);
    await ctx.db.patch(me._id, {
      ...(archived === undefined ? {} : { archived }),
      ...(muted === undefined ? {} : { muted }),
    });
  },
});

/** A member leaves; the app only offers this once they're settled up. Owners delete instead. */
export const leaveGroup = mutation({
  args: { groupId: v.id("sharedGroups") },
  handler: async (ctx, { groupId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, groupId, user.id);
    if (me.role === "owner") throw new Error("The owner can't leave");
    await ctx.db.patch(me._id, { status: "left" });
    const group = await ctx.db.get(groupId);
    if (group) await bumpSeq(ctx, group);
  },
});

/** Owner removes someone; their past expenses stay on the group under their name. */
export const removeMember = mutation({
  args: { groupId: v.id("sharedGroups"), memberId: v.string() },
  handler: async (ctx, { groupId, memberId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, groupId, user.id);
    if (me.role !== "owner") throw new Error("Only the owner can remove people");
    const members = await membersOf(ctx, groupId);
    const target = members.find((member) => member.memberId === memberId);
    if (!target || target.role === "owner") throw new Error("Member not found");
    await ctx.db.patch(target._id, { status: "removed" });
    const group = await ctx.db.get(groupId);
    if (group) await bumpSeq(ctx, group);
  },
});

/** Owner invalidates the current link and gets a new one. */
export const resetInviteCode = mutation({
  args: { groupId: v.id("sharedGroups") },
  handler: async (ctx, { groupId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, groupId, user.id);
    if (me.role !== "owner") throw new Error("Only the owner can reset the link");
    const group = await ctx.db.get(groupId);
    if (!group) return;
    await ctx.db.patch(groupId, { inviteCode: await uniqueInviteCode(ctx), seq: group.seq + 1 });
  },
});

/**
 * Owner deletes the group; only allowed once no one else who joined is still on it. A planned trip
 * has no money to settle, so its owner can discard it for everyone.
 */
export const deleteSharedGroup = mutation({
  args: { groupId: v.id("sharedGroups") },
  handler: async (ctx, { groupId }) => {
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, groupId, user.id);
    if (me.role !== "owner") throw new Error("Only the owner can delete the group");
    const group = await ctx.db.get(groupId);
    const members = await membersOf(ctx, groupId);
    if (!isPlannedData(group?.data) && members.some((member) => member.userId && member.userId !== user.id && member.status === "active")) {
      throw new Error("Remove everyone else first");
    }
    await purgeGroup(ctx, groupId);
  },
});

async function purgeGroup(ctx: MutationCtx, groupId: Id<"sharedGroups">) {
  for (const member of await membersOf(ctx, groupId)) await ctx.db.delete(member._id);
  const notifyRows = await ctx.db
    .query("groupNotifyState")
    .withIndex("by_group_actor", (q) => q.eq("groupId", groupId))
    .collect();
  for (const row of notifyRows) await ctx.db.delete(row._id);
  await ctx.db.delete(groupId);
  await ctx.scheduler.runAfter(0, internal.groups.purgeGroupRecords, { groupId });
}

export const purgeGroupRecords = internalMutation({
  args: { groupId: v.id("sharedGroups") },
  handler: async (ctx, { groupId }) => {
    const batch = await ctx.db
      .query("groupRecords")
      .withIndex("by_group_seq", (q) => q.eq("groupId", groupId))
      .take(PURGE_BATCH);
    for (const doc of batch) await ctx.db.delete(doc._id);
    if (batch.length === PURGE_BATCH) await ctx.scheduler.runAfter(0, internal.groups.purgeGroupRecords, { groupId });
  },
});

/**
 * Account deletion: the user leaves every shared group. Groups they own pass to the longest-standing
 * member who joined; groups with no one else left are deleted.
 */
export async function removeUserFromGroups(ctx: MutationCtx, userId: string) {
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const me of memberships) {
    const group = await ctx.db.get(me.groupId);
    if (!group) continue;
    const others = (await membersOf(ctx, me.groupId))
      .filter((member) => member.userId && member.userId !== userId && member.status === "active")
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (me.role === "owner") {
      if (others.length === 0) {
        await purgeGroup(ctx, me.groupId);
        continue;
      }
      await ctx.db.patch(others[0]._id, { role: "owner" });
      await ctx.db.patch(group._id, { ownerUserId: others[0].userId! });
    }
    await ctx.db.patch(me._id, { userId: undefined, role: "member", status: "left" });
    await bumpSeq(ctx, group);
    await ctx.scheduler.runAfter(0, internal.groups.clearRecordAuthor, { groupId: me.groupId, userId, cursor: null });
  }
}

/** Account deletion: drops the deleted user's id from the records they last edited on a group that lives on. */
export const clearRecordAuthor = internalMutation({
  args: { groupId: v.id("sharedGroups"), userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { groupId, userId, cursor }) => {
    const page = await ctx.db
      .query("groupRecords")
      .withIndex("by_group_seq", (q) => q.eq("groupId", groupId))
      .paginate({ cursor, numItems: PURGE_BATCH });
    for (const doc of page.page) {
      if (doc.updatedBy === userId) await ctx.db.patch(doc._id, { updatedBy: undefined });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.groups.clearRecordAuthor, { groupId, userId, cursor: page.continueCursor });
    }
  },
});

/**
 * Asks whoever holds an item's ticket to send it: a push to the members the item's `ticketHolders`
 * names (other than the caller). Tickets themselves never touch the server.
 */
export const askForTicket = mutation({
  args: { groupId: v.id("sharedGroups"), clientId: v.string() },
  handler: async (ctx, { groupId, clientId }) => {
    assertMaxLength(clientId, MAX_CLIENT_ID, "Item id");
    const user = await requireUser(ctx);
    const me = await requireMember(ctx, groupId, user.id);
    const record = await ctx.db
      .query("groupRecords")
      .withIndex("by_group_record", (q) => q.eq("groupId", groupId).eq("kind", "event").eq("clientId", clientId))
      .unique();
    const data = record && !record.deleted ? (record.data as { title?: unknown; ticketHolders?: unknown } | null) : null;
    const holders = Array.isArray(data?.ticketHolders)
      ? data.ticketHolders.filter((id): id is string => typeof id === "string" && id !== me.memberId)
      : [];
    if (holders.length === 0) throw new Error("No one has shared this ticket");
    const { ok } = await rateLimiter.limit(ctx, "ticketAsk", { key: `${user.id}:${groupId}:${clientId}` });
    if (!ok) return { sent: false };
    await ctx.scheduler.runAfter(0, internal.pushNotifications.notifyTicketAsk, {
      groupId,
      askerMemberId: me.memberId,
      holderMemberIds: holders,
      clientId,
      title: typeof data?.title === "string" ? data.title : "",
    });
    return { sent: true };
  },
});

/** Push tokens of specific members (a direct ask, so a muted group still gets it). */
export const memberPushTargets = internalQuery({
  args: { groupId: v.id("sharedGroups"), memberIds: v.array(v.string()), actorMemberId: v.string() },
  handler: async (ctx, { groupId, memberIds, actorMemberId }) => {
    const group = await ctx.db.get(groupId);
    if (!group) return null;
    const members = await membersOf(ctx, groupId);
    const actor = members.find((member) => member.memberId === actorMemberId);
    const targets: { token: string; locale: string }[] = [];
    for (const member of members) {
      if (!member.userId || !memberIds.includes(member.memberId) || member.status !== "active") continue;
      const tokens = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", member.userId!))
        .collect();
      targets.push(...tokens.map((token) => ({ token: token.token, locale: token.locale })));
    }
    const groupName = (group.data as { name?: unknown } | null)?.name;
    return { groupName: typeof groupName === "string" ? groupName : "", actorName: actor?.name ?? "", targets };
  },
});

/** Who to notify about a change, with their tokens; used by the push action. */
export const notificationTargets = internalQuery({
  args: { groupId: v.id("sharedGroups"), actorMemberId: v.string() },
  handler: async (ctx, { groupId, actorMemberId }) => {
    const group = await ctx.db.get(groupId);
    if (!group) return null;
    const members = await membersOf(ctx, groupId);
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
    const groupName = (group.data as { name?: unknown } | null)?.name;
    return { groupName: typeof groupName === "string" ? groupName : "", actorName: actor?.name ?? "", targets };
  },
});
