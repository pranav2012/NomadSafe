import { PEOPLE, type Person } from "./data/demo";

export interface Transfer {
  from: Person;
  to: Person;
  cents: number;
}

/** Equal split in cents; the first people absorb the leftover cents, like the app. */
export function splitEqually(totalCents: number, people: Person[]): Map<Person, number> {
  const base = Math.floor(totalCents / people.length);
  let extra = totalCents - base * people.length;
  const shares = new Map<Person, number>();
  for (const person of people) {
    shares.set(person, base + (extra > 0 ? 1 : 0));
    extra -= 1;
  }
  return shares;
}

/** Applies a spend you paid, split equally between you and `with`, to the group's net balances. */
export function addSpend(net: Record<Person, number>, totalCents: number, withPeople: Person[]) {
  const shares = splitEqually(totalCents, ["You", ...withPeople]);
  const next = { ...net };
  next.You += totalCents;
  for (const [person, share] of shares) next[person] -= share;
  return { net: next, yourShare: shares.get("You") ?? 0 };
}

/** Greedy largest-debtor → largest-creditor matching (the app's simplifyDebts). */
export function simplify(net: Record<Person, number>): Transfer[] {
  const debtors = (Object.entries(net) as [Person, number][]).filter(([, v]) => v < 0).map(([p, v]) => ({ p, v: -v }));
  const creditors = (Object.entries(net) as [Person, number][]).filter(([, v]) => v > 0).map(([p, v]) => ({ p, v }));
  const transfers: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.v - a.v);
    creditors.sort((a, b) => b.v - a.v);
    const cents = Math.min(debtors[0].v, creditors[0].v);
    transfers.push({ from: debtors[0].p, to: creditors[0].p, cents });
    debtors[0].v -= cents;
    creditors[0].v -= cents;
    if (debtors[0].v === 0) debtors.shift();
    if (creditors[0].v === 0) creditors.shift();
  }
  return transfers;
}

/** What each flatmate owes you (positive) or you owe them (negative), from the simplified transfers. */
export function withYou(transfers: Transfer[]): Record<(typeof PEOPLE)[number], number> {
  const out = { Maya: 0, Leo: 0, Sofia: 0 };
  for (const t of transfers) {
    if (t.to === "You" && t.from !== "You") out[t.from] += t.cents;
    if (t.from === "You" && t.to !== "You") out[t.to] -= t.cents;
  }
  return out;
}

export function formatMoney(cents: number, symbol = "$") {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "−" : ""}${symbol}${whole}.${String(abs % 100).padStart(2, "0")}`;
}
