import { SELF_ID, splitEqually, type ExpenseShare } from "@/features/expenses/utils/split";

export interface PartyInfo {
  pax: number | null;
  /** As written, e.g. "Alex Morgan" or "MORGAN ALEX". */
  names: string[];
}

/** A suggested split the user still has to confirm or complete. */
export interface SplitHint {
  pax: number;
  people: string[];
  /** Proposed equal shares; unset when the other people can't be told apart. */
  shares?: ExpenseShare[];
}

export type AutoSplit = { kind: "split"; shares: ExpenseShare[] } | { kind: "hint"; hint: SplitHint } | null;

const MAX_PAX = 12;
const COUNT_PATTERNS = [
  /\b(?:booked|reserved|reservation|booking)\s+for\s+(\d{1,2})\s+(?:adults?|guests?|people|persons?|travell?ers?)(?:\s*(?:,|and)\s*(\d{1,2})\s+child(?:ren)?)?/i,
  /\b(?:guests?|pax|travell?ers?|passengers?|no\.? of (?:guests|people|persons))\s*[:：]\s*(\d{1,2})\b/i,
];
const UNIT_PATTERN = /\b(\d{1,2})\s*x\s*(?:adults?|child(?:ren)?|guests?|pax|persons?|people|seniors?|students?)\b/gi;
const GUEST_NAME = /\b(?:for guests?|guest names?\s*[:：]|lead guest\s*[:：]?)\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3})/gu;
const PASSENGER_NAME = /\b(?:MR|MRS|MS|MISS|MSTR|DR)\.?\s+([A-Z][A-Z'-]+)\s*\/?\s*([A-Z][A-Z'-]+)\b/g;
const SLASH_PASSENGER = /\b([A-Z][A-Z'-]+)\/([A-Z][A-Z'-]+)\s*(?:MR|MRS|MS|MISS|MSTR|DR)\b/g;

const tokens = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Head-count and named guests/passengers from a booking email. */
export function parseParty(text: string): PartyInfo {
  let pax: number | null = null;
  for (const pattern of COUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      pax = Number(match[1]) + Number(match[2] ?? 0);
      break;
    }
  }
  if (pax === null) {
    const units = [...text.matchAll(UNIT_PATTERN)].reduce((sum, match) => sum + Number(match[1]), 0);
    if (units > 0) pax = units;
  }

  const names = new Map<string, string>();
  const add = (name: string) => {
    const key = tokens(name).sort().join(" ");
    if (key && !names.has(key)) names.set(key, name.trim());
  };
  for (const match of text.matchAll(GUEST_NAME)) add(match[1]);
  for (const match of text.matchAll(PASSENGER_NAME)) add(`${match[1]} ${match[2]}`);
  for (const match of text.matchAll(SLASH_PASSENGER)) add(`${match[1]} ${match[2]}`);

  const named = [...names.values()];
  const count = pax ?? (named.length > 0 ? named.length : null);
  return { pax: count !== null && count >= 1 && count <= MAX_PAX ? Math.max(count, named.length) : null, names: named };
}

/** Matches a written name ("MORGAN ALEX", "Rahul S") to a person by any of its words, in any order. */
function namesMatch(written: string, person: string): boolean {
  const writtenTokens = new Set(tokens(written));
  const personTokens = tokens(person);
  if (personTokens.length === 0) return false;
  return personTokens.every((token) => writtenTokens.has(token)) || writtenTokens.has(personTokens[0]);
}

/** Splits a booking you paid among named companions, or the whole group when the head-count matches; else a hint. */
export function planAutoSplit(
  party: PartyInfo,
  options: { amount: number; currency: string; companions: string[]; selfName?: string | null; shared: boolean },
): AutoSplit {
  const { amount, currency, companions, selfName, shared } = options;
  if (companions.length === 0 || !party.pax || party.pax < 2) return null;

  const matched = new Set<string>();
  for (const name of party.names) {
    if (selfName && namesMatch(name, selfName)) continue;
    const candidates = companions.filter((companion) => namesMatch(name, companion));
    if (candidates.length === 1) matched.add(candidates[0]);
  }
  const known = [SELF_ID, ...companions.filter((companion) => matched.has(companion))];

  let people: string[] | null = null;
  if (known.length === party.pax) people = known;
  else if (party.pax === companions.length + 1) people = [SELF_ID, ...companions];
  if (!people) return { kind: "hint", hint: { pax: party.pax, people: known } };

  const shares = splitEqually(amount, currency, people);
  return shared ? { kind: "hint", hint: { pax: party.pax, people, shares } } : { kind: "split", shares };
}
