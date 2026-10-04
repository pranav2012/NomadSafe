import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import {
  isSelfWord,
  matchCompanion,
  roundMoney,
  SELF_ID,
  type ExpenseShare,
} from "@/features/expenses/utils/split";

const CATEGORIES: ExpenseCategory[] = ["food", "stays", "travel", "shopping", "other"];
const MAX_DAYS_AGO = 60;

/** Raw fields the local model extracts; it never does arithmetic. */
export interface VoiceExtraction {
  intent: "expense" | "repayment" | "unclear";
  amount: number;
  currency: string;
  description: string;
  category: string;
  paid_by: string;
  split_with: string[];
  everyone: boolean;
  include_me: boolean;
  fixed_shares: { person: string; amount: number }[];
  repayment_from: string;
  repayment_to: string;
  days_ago: number;
}

export const VOICE_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["expense", "repayment", "unclear"] },
    amount: { type: "number" },
    currency: { type: "string" },
    description: { type: "string" },
    category: { type: "string", enum: CATEGORIES },
    paid_by: { type: "string" },
    split_with: { type: "array", items: { type: "string" } },
    everyone: { type: "boolean" },
    include_me: { type: "boolean" },
    fixed_shares: {
      type: "array",
      items: {
        type: "object",
        properties: { person: { type: "string" }, amount: { type: "number" } },
        required: ["person", "amount"],
      },
    },
    repayment_from: { type: "string" },
    repayment_to: { type: "string" },
    days_ago: { type: "integer" },
  },
  required: [
    "intent",
    "amount",
    "currency",
    "description",
    "category",
    "paid_by",
    "split_with",
    "everyone",
    "include_me",
    "fixed_shares",
    "repayment_from",
    "repayment_to",
    "days_ago",
  ],
} as const;

export const VOICE_EXTRACTION_SYSTEM_PROMPT =
  "You read one spoken sentence from a traveler and extract a single expense or repayment as JSON. " +
  'The speaker is "me". ' +
  "Fields: intent is expense (someone paid for something), repayment (one person paid another back) or unclear. " +
  "amount is the total number spoken, copied exactly; never calculate or divide. " +
  'currency is the ISO 4217 code if a currency is said (rupees=INR, dollars=USD, euros=EUR, baht=THB, yen=JPY, pounds=GBP), else "". ' +
  "description is 2-4 words for what was bought, without the amount or names. " +
  "category is food, stays, travel, shopping or other. " +
  'paid_by is "me" unless the sentence says someone else paid. ' +
  "split_with lists the other people the cost is shared with, as spoken. " +
  'everyone is true only for "everyone", "all of us", "the whole group". ' +
  "include_me is false only if the speaker says they are not part of the split. " +
  "fixed_shares lists only people given a specific amount of their own. " +
  'For repayments set repayment_from (who paid back) and repayment_to (who received), using "me" for the speaker. ' +
  'days_ago is 1 for "yesterday", 0 otherwise unless another day is said. ' +
  'Use "" and [] for fields that do not apply. Output JSON only.';

export function voiceExtractionRequest(transcript: string, companions: string[]): string {
  return [
    `Trip companions: ${companions.length > 0 ? companions.join(", ") : "none"}`,
    `Sentence: ${JSON.stringify(transcript)}`,
    "JSON:",
  ].join("\n");
}

export interface VoiceExpenseDraft {
  kind: "expense";
  amount: number;
  currency: string;
  merchant: string;
  category: ExpenseCategory;
  date: string;
  paidBy: string;
  people: string[];
  explicitShares: ExpenseShare[];
  unknownNames: string[];
  amountUncertain: boolean;
  transcript: string;
}

export interface VoiceSettlementDraft {
  kind: "settlement";
  amount: number;
  currency: string;
  from: string;
  to: string;
  date: string;
  unknownNames: string[];
  amountUncertain: boolean;
  transcript: string;
}

export type VoiceDraft =
  | VoiceExpenseDraft
  | VoiceSettlementDraft
  | { kind: "unclear"; transcript: string };

export interface InterpretContext {
  companions: string[];
  tripCurrency: string;
  now?: Date;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

function titleCase(value: string): string {
  return value.replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1));
}

/** Numbers as the recognizer wrote them ("1,250", "12.50", "₹500"). */
export function numbersInTranscript(transcript: string): number[] {
  const matches = transcript.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((match) => Number(match.replace(/,/g, ""))).filter((value) => Number.isFinite(value));
}

function normalizeCurrency(value: unknown, fallback: string): string {
  const code = asString(value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return fallback;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return code;
  } catch {
    return fallback;
  }
}

function dateFromDaysAgo(value: unknown, now: Date): string {
  const days = Number.isInteger(value) ? Math.min(MAX_DAYS_AGO, Math.max(0, value as number)) : 0;
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

/** Resolves names against the trip and flags unknown names or an amount that wasn't actually heard. */
export function interpretVoiceExtraction(
  raw: unknown,
  transcript: string,
  context: InterpretContext,
): VoiceDraft {
  const data = (raw && typeof raw === "object" ? raw : {}) as Partial<VoiceExtraction>;
  const now = context.now ?? new Date();
  const spokenAmount = Number(data.amount);
  const currency = normalizeCurrency(data.currency, context.tripCurrency);
  const amount = Number.isFinite(spokenAmount) ? roundMoney(spokenAmount, currency) : NaN;
  if (data.intent === "unclear" || !Number.isFinite(amount) || amount <= 0) {
    return { kind: "unclear", transcript };
  }

  const unknownNames: string[] = [];
  const resolve = (spoken: string): string => {
    if (isSelfWord(spoken)) return SELF_ID;
    const match = matchCompanion(spoken, context.companions);
    if (match) return match;
    const name = titleCase(spoken);
    if (!unknownNames.includes(name)) unknownNames.push(name);
    return name;
  };

  const heard = numbersInTranscript(transcript);
  const amountUncertain = heard.length > 0 && !heard.includes(spokenAmount);
  const date = dateFromDaysAgo(data.days_ago, now);

  if (data.intent === "repayment") {
    const from = resolve(asString(data.repayment_from) || "me");
    const to = resolve(asString(data.repayment_to) || "me");
    if (from === to) return { kind: "unclear", transcript };
    return { kind: "settlement", amount, currency, from, to, date, unknownNames, amountUncertain, transcript };
  }

  const paidBy = resolve(asString(data.paid_by) || "me");
  const explicitShares: ExpenseShare[] = (Array.isArray(data.fixed_shares) ? data.fixed_shares : [])
    .map((share) => ({ person: asString(share?.person), amount: Number(share?.amount) }))
    .filter((share) => share.person && Number.isFinite(share.amount) && share.amount > 0)
    .map((share) => ({ person: resolve(share.person), amount: share.amount }));

  const named = asStringList(data.split_with).map(resolve);
  const people = new Set<string>();
  if (data.everyone) context.companions.forEach((name) => people.add(name));
  named.forEach((person) => people.add(person));
  explicitShares.forEach((share) => people.add(share.person));
  if (people.size > 0) {
    if (data.include_me !== false) people.add(SELF_ID);
    if (paidBy !== SELF_ID) people.add(paidBy);
  } else if (paidBy !== SELF_ID) {
    // "Raj paid 500 for dinner" with no split named means Raj covered the speaker.
    people.add(SELF_ID);
  }

  const category = CATEGORIES.includes(data.category as ExpenseCategory)
    ? (data.category as ExpenseCategory)
    : "other";

  return {
    kind: "expense",
    amount,
    currency,
    merchant: titleCase(asString(data.description)) || "",
    category,
    date,
    paidBy,
    people: [...people],
    explicitShares,
    unknownNames,
    amountUncertain,
    transcript,
  };
}

/** Swaps a spoken name for another person (or drops it when `replacement` is null). */
export function replaceDraftPerson<T extends VoiceDraft>(draft: T, name: string, replacement: string | null): T {
  if (draft.kind === "unclear") return draft;
  const unknownNames = draft.unknownNames.filter((entry) => entry !== name);
  const swap = (person: string) => (person === name ? replacement ?? SELF_ID : person);

  if (draft.kind === "settlement") {
    return { ...draft, from: swap(draft.from), to: swap(draft.to), unknownNames };
  }
  const people = draft.people
    .map((person) => (person === name ? replacement : person))
    .filter((person): person is string => person !== null);
  return {
    ...draft,
    paidBy: swap(draft.paidBy),
    people: [...new Set(people)],
    explicitShares: draft.explicitShares
      .map((share) => (share.person === name ? { ...share, person: replacement ?? "" } : share))
      .filter((share) => share.person),
    unknownNames,
  };
}
