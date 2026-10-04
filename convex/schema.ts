import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const tripRecordKindValidator = v.union(v.literal("expense"), v.literal("settlement"), v.literal("event"));

export const syncKindValidator = v.union(v.literal("trip"), v.literal("expense"), v.literal("settlement"), v.literal("event"));

export default defineSchema({
  // Links a contact (owner) to another NomadSafe user (linkedUser) by email.
  contactLinks: defineTable({
    ownerUserId: v.string(),
    linkedUserId: v.string(),
    name: v.string(),
    email: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_email", ["ownerUserId", "email"])
    .index("by_linked", ["linkedUserId"])
    .index("by_linked_status", ["linkedUserId", "status"]),

  // Outgoing share records written by the broadcaster.
  locationShares: defineTable({
    ownerUserId: v.string(),
    recipientUserId: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    battery: v.optional(v.number()),
    mode: v.union(
      v.literal("normal"),
      v.literal("low"),
      v.literal("emergency"),
    ),
    active: v.boolean(),
    paused: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_recipient", ["recipientUserId"])
    .index("by_owner_recipient", ["ownerUserId", "recipientUserId"]),

  // Pending app-invites for contacts not yet on NomadSafe.
  pendingInvites: defineTable({
    ownerUserId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    invitedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_email", ["ownerUserId", "email"])
    .index("by_owner_phone", ["ownerUserId", "phone"])
    .index("by_email", ["email"]),

  // Trips, expenses, settlements and itinerary events backed up from the app. `data` is the
  // client's record (raw imported text stripped); deletions are kept as tombstones so other
  // devices learn about them.
  syncRecords: defineTable({
    userId: v.string(),
    kind: syncKindValidator,
    clientId: v.string(),
    data: v.optional(v.any()),
    deleted: v.boolean(),
    // Client edit time, for last-write-wins between devices.
    updatedAt: v.number(),
    // Per-user, strictly increasing write counter; devices pull everything after the last one they saw.
    serverSeq: v.number(),
  })
    .index("by_user_record", ["userId", "kind", "clientId"])
    .index("by_user_seq", ["userId", "serverSeq"]),

  syncState: defineTable({
    userId: v.string(),
    seq: v.number(),
  }).index("by_user", ["userId"]),

  // Group trips shared through an invite link. `data` holds the trip details (no companions;
  // people are tripMembers). `seq` bumps on every change so members know when to pull.
  sharedTrips: defineTable({
    ownerUserId: v.string(),
    inviteCode: v.string(),
    data: v.any(),
    dataUpdatedAt: v.number(),
    seq: v.number(),
    createdAt: v.number(),
  }).index("by_code", ["inviteCode"]),

  // People on a shared trip. `memberId` is what expenses and settlements refer to; members without
  // `userId` are name-only companions that someone can claim when they join.
  tripMembers: defineTable({
    tripId: v.id("sharedTrips"),
    memberId: v.string(),
    name: v.string(),
    userId: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("left"), v.literal("removed")),
    // Per-member preferences: hide the trip from their list, silence its notifications.
    archived: v.boolean(),
    muted: v.boolean(),
    joinedAt: v.number(),
  })
    .index("by_trip", ["tripId"])
    .index("by_user", ["userId"])
    .index("by_trip_user", ["tripId", "userId"]),

  // Expenses, settlements and itinerary events of a shared trip, last write wins by `updatedAt`.
  tripRecords: defineTable({
    tripId: v.id("sharedTrips"),
    kind: tripRecordKindValidator,
    clientId: v.string(),
    data: v.optional(v.any()),
    deleted: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.string(),
    seq: v.number(),
  })
    .index("by_trip_record", ["tripId", "kind", "clientId"])
    .index("by_trip_seq", ["tripId", "seq"]),

  // Server side of SOS and check-in: the check-in deadline (and its scheduled alert) and which
  // alert linked contacts were last sent, so they hear when the user is safe again.
  safetyAlerts: defineTable({
    userId: v.string(),
    checkInEndsAt: v.optional(v.number()),
    checkInJob: v.optional(v.id("_scheduled_functions")),
    activeAlert: v.optional(v.union(v.literal("sos"), v.literal("missedCheckIn"))),
    lastSosAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // Expo push tokens, one row per device, with the app language for notification text.
  pushTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    locale: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  // The user's paid entitlements, copied from RevenueCat (webhook or an in-app refresh).
  entitlements: defineTable({
    userId: v.string(),
    unlimitedTrips: v.boolean(),
    cloudAi: v.boolean(),
    expiresAt: v.optional(v.number()),
    productId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Cloud AI calls per user per calendar month (UTC, "YYYY-MM").
  aiUsage: defineTable({
    userId: v.string(),
    month: v.string(),
    chat: v.number(),
    tasks: v.number(),
    // Per-feature request counts (never content); rows from before this field have none.
    byTask: v.optional(
      v.object({
        chat: v.optional(v.number()),
        chatSummary: v.optional(v.number()),
        tripBudget: v.optional(v.number()),
        tripName: v.optional(v.number()),
        itinerary: v.optional(v.number()),
        voiceExpense: v.optional(v.number()),
      }),
    ),
  }).index("by_user_month", ["userId", "month"]),

  // Web deletion requests from users who can no longer open the app.
  deletionRequests: defineTable({
    email: v.string(),
    reason: v.optional(v.string()),
    requestedAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("completed")),
  }).index("by_email", ["email"]),
});
