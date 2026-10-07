import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import { embedFor } from "@/features/itinerary/utils/sharedLinks";

/** Opens a saved idea's link: reels and videos in the in-app player, other pages in the in-app browser. False when it has no link. */
export function useOpenIdea() {
  const router = useRouter();
  return (idea: TripEvent): boolean => {
    const link = idea.link;
    if (!link) return false;
    // The Saved sheet is a modal: close it first, or the player would open underneath on Android.
    useSavedSheetStore.getState().close();
    if (embedFor(link)) {
      router.push({ pathname: "/idea/[eventId]", params: { eventId: idea.id } });
    } else {
      WebBrowser.openBrowserAsync(link.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => Linking.openURL(link.url).catch(() => {}));
    }
    return true;
  };
}
