import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_GAP = 10;
/** iOS uses the system UITabBar, which is already part of the bottom safe area; Android floats the glass bar. */
export const NATIVE_TAB_BAR = Platform.OS === "ios";

/** True while the software keyboard is open; the floating tab bar hides then. */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** Space a tab screen must leave at the bottom so content clears the floating tab bar. */
export function useTabBarInset() {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  if (keyboardVisible) return 0;
  return NATIVE_TAB_BAR ? insets.bottom + 8 : insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + 8;
}

/** Bottom offset for chrome that floats just above the tab bar (capture bar, AI composer). */
export function useFloatingBarBottom() {
  const insets = useSafeAreaInsets();
  return NATIVE_TAB_BAR ? insets.bottom + 10 : insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + 10;
}
