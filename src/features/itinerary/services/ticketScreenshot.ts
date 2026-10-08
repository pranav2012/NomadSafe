import * as ImagePicker from "expo-image-picker";
import { ocr } from "@/modules/ocr";
import { logger } from "@/modules/logger";
import { withSystemPrompt } from "@/utils/systemPrompt";
import type { Trip } from "@/features/trips/store/tripsStore";
import { bookingsFromText, type TextBooking } from "@/features/itinerary/services/itineraryExtraction";

export interface ScreenshotRead {
  uri: string;
  name: string;
  /** The first booking found in it; null when the text didn't look like one (or text reading isn't in this build). */
  booking: TextBooking | null;
}

/**
 * Lets the user pick a ticket or booking screenshot (system picker, no photo permission), reads its
 * text on the phone and parses it like a booking email. Nothing leaves the phone. Null when cancelled.
 */
export async function readTicketScreenshot(trip: Trip | null): Promise<ScreenshotRead | null> {
  const result = await withSystemPrompt(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 }));
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const read: ScreenshotRead = { uri: asset.uri, name: asset.fileName ?? "ticket.jpg", booking: null };
  if (!ocr.isAvailable) return read;
  try {
    const lines = await ocr.readLines(asset.uri);
    read.booking = bookingsFromText(lines.join("\n"), trip)[0] ?? null;
  } catch (error) {
    logger.warn("ticket-screenshot", "couldn't read the screenshot", error);
  }
  return read;
}
