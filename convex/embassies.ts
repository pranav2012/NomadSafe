import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const embassyFields = {
  name: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  mapsUrl: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
};

export const cached = internalQuery({
  args: { key: v.string() },
  handler: (ctx, { key }) =>
    ctx.db
      .query("embassies")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
});

export const store = internalMutation({
  args: { key: v.string(), ...embassyFields },
  handler: async (ctx, { key, ...fields }) => {
    const existing = await ctx.db
      .query("embassies")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const row = { key, ...fields, fetchedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("embassies", row);
  },
});
