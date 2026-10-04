import { VOICE_EXTRACTION_SCHEMA } from "@/features/expenses/services/voiceExpense";
import { EXPENSE_CATEGORY_VALUES } from "./prompts";

export type JsonSchema = Record<string, unknown>;

export interface JsonTask {
  name: string;
  schema: JsonSchema;
}

/**
 * Online providers' strict JSON modes reject objects that allow extra keys, so every object in the
 * schema gets `additionalProperties: false`.
 */
export function strictSchema(schema: unknown): JsonSchema {
  if (Array.isArray(schema)) return schema.map(strictSchema) as unknown as JsonSchema;
  if (!schema || typeof schema !== "object") return schema as JsonSchema;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) out[key] = strictSchema(value);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export const AI_TASKS = {
  budget: {
    name: "trip_budget",
    schema: strictSchema({
      type: "object",
      properties: { total: { type: "number" }, daily: { type: "number" }, rationale: { type: "string" } },
      required: ["total", "daily", "rationale"],
    }),
  },
  tripName: {
    name: "trip_name",
    schema: strictSchema({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }),
  },
  itinerary: {
    name: "itinerary_refinement",
    schema: strictSchema({
      type: "object",
      properties: { keepIds: { type: "array", items: { type: "string" } } },
      required: ["keepIds"],
    }),
  },
  voice: { name: "voice_expense", schema: strictSchema(VOICE_EXTRACTION_SCHEMA) },
  category: {
    name: "expense_category",
    schema: strictSchema({
      type: "object",
      properties: { category: { type: "string", enum: EXPENSE_CATEGORY_VALUES } },
      required: ["category"],
    }),
  },
  summary: {
    name: "chat_memory",
    schema: strictSchema({ type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }),
  },
} satisfies Record<string, JsonTask>;
