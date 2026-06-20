import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    defaultCurrency: v.string(),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone"]),

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
    .index("by_owner_phone", ["ownerUserId", "phone"]),
});
