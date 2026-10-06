import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { SELF_ID } from "@/features/expenses/utils/split";
import { transitModeOf } from "@/features/itinerary/utils/transit";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { logger } from "@/modules/logger";
import { withSystemPrompt } from "@/utils/systemPrompt";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useTicketsStore, type Ticket } from "@/features/itinerary/store/ticketsStore";

const TICKETS_DIR = `${FileSystem.documentDirectory}tickets/`;
// Booking PDFs are a few hundred KB; anything far bigger isn't a ticket.
export const MAX_TICKET_BYTES = 10 * 1024 * 1024;

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const extensionOf = (name: string, kind: Ticket["kind"]) => name.match(/\.[a-z0-9]{2,5}$/i)?.[0].toLowerCase() ?? (kind === "pdf" ? ".pdf" : ".jpg");
const ticketDir = (id: string) => `${TICKETS_DIR}${id}/`;

/**
 * A fresh folder for one ticket, so the file keeps its own readable name ("boarding-pass.pdf")
 * when it's sent to someone; returns its id and where to write the file.
 */
async function newTicketFile(name: string, kind: Ticket["kind"]) {
  const id = newId();
  await FileSystem.makeDirectoryAsync(ticketDir(id), { intermediates: true });
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "ticket";
  return { id, uri: `${ticketDir(id)}${base}${extensionOf(name, kind)}` };
}

/** Boarding passes stay private unless the holder chooses to show the group they have one. */
function sharedByDefault(eventId: string): boolean {
  const event = useEventsStore.getState().events.find((item) => item.id === eventId);
  return !event || transitModeOf(event) !== "flight";
}

/**
 * On a shared trip, keeps this phone in the item's `ticketHolders` exactly while it has a ticket the
 * group may see; the label syncs, the files never do.
 */
export function syncTicketHolder(eventId: string) {
  const event = useEventsStore.getState().events.find((item) => item.id === eventId);
  const trip = event && useTripsStore.getState().trips.find((item) => item.id === event.tripId);
  if (!event || !trip?.shared) return;
  const holding = useTicketsStore.getState().tickets.some((ticket) => ticket.eventId === eventId && ticket.shared !== false);
  const holders = event.ticketHolders ?? [];
  if (holding === holders.includes(SELF_ID)) return;
  const next = holding ? [...holders, SELF_ID] : holders.filter((person) => person !== SELF_ID);
  useEventsStore.getState().updateEvent(eventId, { ticketHolders: next.length > 0 ? next : undefined });
}

/** Re-asserts this phone's holder labels (another member's edit can overwrite them). */
export function reconcileTicketHolders() {
  const ids = new Set(useTicketsStore.getState().tickets.map((ticket) => ticket.eventId));
  for (const event of useEventsStore.getState().events) {
    if (ids.has(event.id) || event.ticketHolders?.includes(SELF_ID)) syncTicketHolder(event.id);
  }
}

function record(id: string, eventId: string, name: string, kind: Ticket["kind"], uri: string, source: Ticket["source"], sourceKey?: string): Ticket {
  const ticket: Ticket = {
    id,
    eventId,
    name,
    kind,
    uri,
    source,
    sourceKey,
    shared: sharedByDefault(eventId),
    addedAt: new Date().toISOString(),
  };
  useTicketsStore.getState().add(ticket);
  syncTicketHolder(eventId);
  return ticket;
}

async function copyIn(eventId: string, from: string, name: string, kind: Ticket["kind"], source: Ticket["source"]): Promise<Ticket | null> {
  try {
    const { id, uri } = await newTicketFile(name, kind);
    await FileSystem.copyAsync({ from, to: uri });
    return record(id, eventId, name, kind, uri, source);
  } catch (err) {
    logger.warn("tickets", "couldn't keep a file", err);
    return null;
  }
}

/** Opens the system file picker for PDFs and images; resolves how many were attached. */
export async function attachFiles(eventId: string): Promise<number> {
  const result = await withSystemPrompt(() =>
    DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: true, copyToCacheDirectory: true }),
  );
  if (result.canceled) return 0;
  let added = 0;
  for (const asset of result.assets) {
    if ((asset.size ?? 0) > MAX_TICKET_BYTES) continue;
    const kind = asset.mimeType === "application/pdf" || /\.pdf$/i.test(asset.name) ? "pdf" : "image";
    if (await copyIn(eventId, asset.uri, asset.name, kind, "file")) added += 1;
  }
  return added;
}

/** Opens the system photo picker (no photo permission) for screenshots and photos of tickets. */
export async function attachPhotos(eventId: string): Promise<number> {
  const result = await withSystemPrompt(() =>
    ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.9 }),
  );
  if (result.canceled) return 0;
  let added = 0;
  for (const asset of result.assets) {
    if (await copyIn(eventId, asset.uri, asset.fileName ?? "photo.jpg", "image", "photo")) added += 1;
  }
  return added;
}

export function hasGmailTicket(eventId: string, sourceKey: string): boolean {
  return useTicketsStore.getState().tickets.some((ticket) => ticket.sourceKey === sourceKey && ticket.eventId === eventId);
}

/** Keeps a PDF from a booking email; skipped when this file of this email is already saved. */
export async function saveGmailTicket(eventId: string, sourceKey: string, name: string, base64: string): Promise<boolean> {
  if (hasGmailTicket(eventId, sourceKey)) return false;
  const { id, uri } = await newTicketFile(name, "pdf");
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  record(id, eventId, name, "pdf", uri, "gmail", sourceKey);
  return true;
}

export async function removeTickets(tickets: Ticket[]) {
  useTicketsStore.getState().remove(tickets.map((ticket) => ticket.id));
  for (const eventId of new Set(tickets.map((ticket) => ticket.eventId))) syncTicketHolder(eventId);
  await Promise.all(tickets.map((ticket) => FileSystem.deleteAsync(ticketDir(ticket.id), { idempotent: true }).catch(() => {})));
}

export function setTicketShared(ticket: Ticket, shared: boolean) {
  useTicketsStore.getState().setShared(ticket.id, shared);
  syncTicketHolder(ticket.eventId);
}

/** Opens the share sheet (WhatsApp, Nearby Share, AirDrop…) with the file; the receiver opens it with NomadSafe. */
export async function sendTicket(ticket: Ticket) {
  if (!(await Sharing.isAvailableAsync())) return;
  await withSystemPrompt(() =>
    Sharing.shareAsync(ticket.uri, { mimeType: ticket.kind === "pdf" ? "application/pdf" : "image/jpeg", dialogTitle: ticket.name }),
  );
}

/** Keeps a file another app handed us ("Open with NomadSafe") as a ticket on `eventId`. */
export async function saveReceivedTicket(eventId: string, uri: string, kind: Ticket["kind"]): Promise<Ticket | null> {
  const extension = kind === "pdf" ? ".pdf" : ".jpg";
  const fromLink = decodeURIComponent(uri.split("/").pop() ?? "").replace(/\?.*$/, "");
  // Android content links are often opaque ids ("50"); name those after the item instead.
  const title = useEventsStore.getState().events.find((event) => event.id === eventId)?.title ?? "ticket";
  const name = /[a-z]{2}/i.test(fromLink.replace(/\.[a-z0-9]{2,5}$/i, "")) ? fromLink : `${title}${extension}`;
  return copyIn(eventId, uri, /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}${extension}`, kind, "received");
}

/** Deletes tickets whose item no longer exists (item or trip deleted, or removed by sync). */
export async function pruneTickets() {
  const ids = new Set(useEventsStore.getState().events.map((event) => event.id));
  const orphans = useTicketsStore.getState().tickets.filter((ticket) => !ids.has(ticket.eventId));
  if (orphans.length > 0) await removeTickets(orphans);
}

/** Deletes every ticket (wipe, sign-out). */
export async function deleteAllTickets() {
  useTicketsStore.getState().reset();
  await FileSystem.deleteAsync(TICKETS_DIR, { idempotent: true }).catch(() => {});
}
