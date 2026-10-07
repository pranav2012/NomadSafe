import { useState } from "react";
import { api, useQuery } from "@/modules/backend";
import { useAppActive } from "@/hooks/useAnimationsActive";

/** Holds the last loaded value while a query is skipped (e.g. in the background), so screens don't flash empty. */
export function useLastLoaded<T>(value: T | undefined): T | undefined {
  const [kept, setKept] = useState(value);
  if (value !== undefined && value !== kept) setKept(value);
  return value ?? kept;
}

type LinkSummary = { outgoing: { linkedUserId: string; status: string }[] };
type OutgoingShare = { recipientUserId: string; paused: boolean };

/**
 * How many accepted people see you while you share (links minus the ones you paused). `loaded` is
 * false until the links arrive. Queries pause while the app is in the background or `enabled` is false.
 */
export function useSeesYouCount(enabled = true): { count: number; loaded: boolean } {
  const live = useAppActive() && enabled;
  const links = useLastLoaded(useQuery(api.sharing.getContactLinks, live ? {} : "skip") as LinkSummary | undefined);
  const shares = useLastLoaded(useQuery(api.sharing.getOutgoingShares, live ? {} : "skip") as OutgoingShare[] | undefined);
  const paused = new Set((shares ?? []).filter((s) => s.paused).map((s) => s.recipientUserId));
  const count = (links?.outgoing ?? []).filter((link) => link.status === "accepted" && !paused.has(link.linkedUserId)).length;
  return { count, loaded: links !== undefined };
}
