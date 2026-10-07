import { useEffect } from "react";
import { useShareIntent } from "expo-share-intent";
import { useIncomingShareStore } from "@/features/itinerary/store/incomingShareStore";

/** Android's share sheet ("NomadSafe" in the list): hands the shared text to "Save idea". Renders nothing. */
export function AndroidShareIntake() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });
  useEffect(() => {
    if (!hasShareIntent) return;
    const caption = shareIntent.text?.trim() ?? "";
    const link = shareIntent.webUrl ?? "";
    const text = link && !caption.includes(link) ? `${caption} ${link}`.trim() : caption || link;
    if (text) useIncomingShareStore.getState().set(text);
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);
  return null;
}
