import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

/**
 * Live subscription to incoming location shares.
 */
export function useIncomingShares() {
  return useQuery(api.sharing.getIncomingShares);
}

/**
 * Live subscription to contact links (outgoing + incoming).
 */
export function useContactLinks() {
  return useQuery(api.sharing.getContactLinks);
}
