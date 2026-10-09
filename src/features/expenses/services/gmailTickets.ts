import { withGmailAccess } from "@/features/expenses/services/gmailAuth";
import { fetchGmailPdf } from "@/features/expenses/services/gmailImport";
import { hasGmailGrant, hydrateGmailConnection, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";
import { useGmailInboxStore, type GmailFileRef, type PendingTicket } from "@/features/expenses/store/gmailInboxStore";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { MAX_TICKET_BYTES, hasGmailTicket, saveGmailTicket } from "@/features/itinerary/services/tickets";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";

const MAX_TRIES = 5;
const sourceKey = (file: Pick<GmailFileRef, "messageId" | "name">) => `${file.messageId}:${file.name}`;
const entryKey = (ticket: Pick<PendingTicket, "eventId" | "messageId" | "name">) => `${ticket.eventId}|${sourceKey(ticket)}`;

let draining: Promise<number> | null = null;

/** Queues a booking email's PDFs for an item; they download on the next drain. */
export function queueGmailTickets(eventId: string, files: GmailFileRef[]): void {
  const wanted = files.filter((file) => file.size <= MAX_TICKET_BYTES && !hasGmailTicket(eventId, sourceKey(file)));
  if (wanted.length > 0) useGmailInboxStore.getState().queueTickets(wanted.map((file) => ({ ...file, eventId })));
}

/** Downloads queued PDFs onto their items; one failure never stops the rest, and failures stay queued to retry. */
export function drainGmailTickets(): Promise<number> {
  draining ??= drain().finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(): Promise<number> {
  await hydrateGmailConnection();
  if (!hasGmailGrant(useGmailConnectionStore.getState().tokens)) return 0;
  const queue = useGmailInboxStore.getState().pendingTickets;
  if (queue.length === 0) return 0;

  const eventIds = new Set(useEventsStore.getState().events.map((event) => event.id));
  const byFile = new Map<string, PendingTicket[]>();
  for (const ticket of queue) byFile.set(sourceKey(ticket), [...(byFile.get(sourceKey(ticket)) ?? []), ticket]);

  const finished = new Set<string>();
  const failed = new Set<string>();
  let saved = 0;
  for (const [key, tickets] of byFile) {
    const live = tickets.filter((ticket) => eventIds.has(ticket.eventId) && !hasGmailTicket(ticket.eventId, key));
    for (const ticket of tickets) if (!live.includes(ticket)) finished.add(entryKey(ticket));
    if (live.length === 0) continue;
    const first = live[0];
    let data: string;
    try {
      data = await withGmailAccess((accessToken) => fetchGmailPdf(accessToken, first.messageId.replace(/^gmail:/, ""), first));
    } catch (error) {
      logger.warn("gmail-tickets", "download failed", error);
      for (const ticket of live) failed.add(entryKey(ticket));
      continue;
    }
    for (const ticket of live) {
      try {
        if (await saveGmailTicket(ticket.eventId, key, ticket.name, data)) saved += 1;
        finished.add(entryKey(ticket));
      } catch (error) {
        logger.warn("gmail-tickets", "save failed", error);
        failed.add(entryKey(ticket));
      }
    }
  }

  // Read the queue again: items may have been confirmed (and queued) while this ran.
  const latest = useGmailInboxStore.getState().pendingTickets;
  useGmailInboxStore.getState().setPendingTickets(
    latest
      .filter((ticket) => !finished.has(entryKey(ticket)))
      .map((ticket) => (failed.has(entryKey(ticket)) ? { ...ticket, tries: ticket.tries + 1 } : ticket))
      .filter((ticket) => ticket.tries < MAX_TRIES),
  );
  if (saved > 0) {
    logger.info("gmail-tickets", "saved", { count: saved, failed: failed.size });
    track("ticket_added", { source: "gmail", count: saved });
  }
  return saved;
}
