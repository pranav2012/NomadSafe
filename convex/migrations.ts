import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation } from "./_generated/server";

const BATCH = 200;

type Table = "syncRecords" | "tripRecords";
type Args = { table?: Table; cursor?: string | null; patched?: number };

// Referenced by name so this one-off file works before `_generated/api` is regenerated.
const self = makeFunctionReference<"mutation", Args>("migrations:stripEmailNotes");

/** The record's data without `note` when it's an email import with one, else null. */
function withoutEmailNote(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.source !== "email" || !("note" in record)) return null;
  const { note: _note, ...rest } = record;
  return rest;
}

/**
 * One-off: removes `note` (email sender, subject, body) from email-imported backups and shared-trip
 * records, a page per run, rescheduling itself through both tables.
 * Run: `npx convex run migrations:stripEmailNotes` (add `--prod` for production).
 */
export const stripEmailNotes = internalMutation({
  args: {
    table: v.optional(v.union(v.literal("syncRecords"), v.literal("tripRecords"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    patched: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const table = args.table ?? "syncRecords";
    const page = await ctx.db.query(table).paginate({ numItems: BATCH, cursor: args.cursor ?? null });
    let patched = args.patched ?? 0;
    for (const doc of page.page) {
      const data = withoutEmailNote(doc.data);
      if (!data) continue;
      await ctx.db.patch(doc._id, { data });
      patched += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, self, { table, cursor: page.continueCursor, patched });
    } else if (table === "syncRecords") {
      await ctx.scheduler.runAfter(0, self, { table: "tripRecords", cursor: null, patched });
    } else {
      console.log(`stripEmailNotes done: ${patched} records patched`);
    }
    return { table, patched, isDone: page.isDone };
  },
});
