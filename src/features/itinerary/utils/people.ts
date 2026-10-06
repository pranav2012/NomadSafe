import { SELF_ID } from "@/features/expenses/utils/split";

interface WithPeople {
  people?: string[];
}

export function isForEveryone(event: WithPeople): boolean {
  return !event.people || event.people.length === 0;
}

/** Items for everyone, or naming you; on a solo trip that's every item. */
export function isForMe(event: WithPeople): boolean {
  return isForEveryone(event) || Boolean(event.people?.includes(SELF_ID));
}
