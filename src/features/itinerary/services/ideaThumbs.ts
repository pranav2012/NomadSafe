import * as FileSystem from "expo-file-system/legacy";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useIdeaThumbsStore } from "@/features/itinerary/store/ideaThumbsStore";
import { logger } from "@/modules/logger";

const DIR = `${FileSystem.documentDirectory}idea-thumbs/`;

/** Keeps a captured frame (a temp file) as a saved idea's preview image. */
export async function keepIdeaThumb(eventId: string, tempUri: string) {
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const target = `${DIR}${eventId.replace(/[^\w-]/g, "_")}.jpg`;
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: tempUri, to: target });
    useIdeaThumbsStore.getState().set(eventId, target);
  } catch (error) {
    logger.warn("idea-thumbs", "keep failed", error);
  }
}

/** Drops preview images whose idea is gone (deleted, planned for a day, or its trip removed). */
export async function pruneIdeaThumbs() {
  const ideas = new Set(useEventsStore.getState().events.filter((event) => event.timing === "wishlist").map((event) => event.id));
  const stale = Object.keys(useIdeaThumbsStore.getState().thumbs).filter((id) => !ideas.has(id));
  if (stale.length === 0) return;
  await Promise.all(stale.map((id) => FileSystem.deleteAsync(useIdeaThumbsStore.getState().thumbs[id], { idempotent: true }).catch(() => {})));
  useIdeaThumbsStore.getState().remove(stale);
}

/** Removes every preview image (sign-out, wipe). */
export async function deleteAllIdeaThumbs() {
  useIdeaThumbsStore.getState().reset();
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
}
