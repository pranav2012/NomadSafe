import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Top inset for screens presented as a modal: iOS page sheets already sit below the status bar. */
export function useSheetTopInset() {
  const { top } = useSafeAreaInsets();
  return Platform.OS === "ios" ? 0 : top;
}
