import { useEffect, useState } from "react";
import { Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_GAP = 10;

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
  return keyboardVisible ? 0 : insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + 8;
}
