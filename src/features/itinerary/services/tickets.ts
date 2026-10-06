import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { logger } from "@/modules/logger";
import { withSystemPrompt } from "@/utils/systemPrompt";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useTicketsStore, type Ticket } from "@/features/itinerary/store/ticketsStore";

const TICKETS_DIR = `${FileSystem.documentDirectory}tickets/`;
// Booking PDFs are a few hundred KB; anything far bigger isn't a ticket.
export const MAX_TICKET_BYTES = 10 * 1024 * 1024;

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const extensionOf = (name: string, kind: Ticket["kind"]) => name.match(/\.[a-z0-9]{2,5}$/i)?.[0].toLowerCase() ?? (kind === "pdf" ? ".pdf" : ".jpg");

async function ensureDir() {
  await FileSystem.makeDirectoryAsync(TICKETS_DIR, { intermediates: true }).catch(() => {});
}

function record(eventId: string, name: string, kind: Ticket["kind"], uri: string, source: Ticket["source"], sourceKey?: string): Ticket {
  const ticket: Ticket = { id: uri.slice(TICKETS_DIR.length).replace(/\.[^.]+$/, ""), eventId, name, kind, uri, source, sourceKey, addedAt: new Date().toISOString() };
  useTicketsStore.getState().add(ticket);
  return ticket;
}

async function copyIn(eventId: string, from: string, name: string, kind: Ticket["kind"], source: Ticket["source"]): Promise<Ticket | null> {
  try {
    await ensureDir();
    const uri = `${TICKETS_DIR}${newId()}${extensionOf(name, kind)}`;
    await FileSystem.copyAsync({ from, to: uri });
    return record(eventId, name, kind, uri, source);
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
  await ensureDir();
  const uri = `${TICKETS_DIR}${newId()}.pdf`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  record(eventId, name, "pdf", uri, "gmail", sourceKey);
  return true;
}

export async function removeTickets(tickets: Ticket[]) {
  useTicketsStore.getState().remove(tickets.map((ticket) => ticket.id));
  await Promise.all(tickets.map((ticket) => FileSystem.deleteAsync(ticket.uri, { idempotent: true }).catch(() => {})));
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
