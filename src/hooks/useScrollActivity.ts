import { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

/** UI-thread flag that is true while a scroll view is dragged or gliding, for pausing heavy animations. */
export function useScrollActivity() {
  const scrolling = useSharedValue(false);
  const onScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      scrolling.set(true);
    },
    onEndDrag: () => {
      scrolling.set(false);
    },
    onMomentumBegin: () => {
      scrolling.set(true);
    },
    onMomentumEnd: () => {
      scrolling.set(false);
    },
  });
  return { scrolling, onScroll };
}
