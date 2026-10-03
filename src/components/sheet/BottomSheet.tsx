import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { springs } from "@/components/motion/springs";
import { lightImpact } from "@/utils/haptics";

export interface BottomSheetColors {
  surface: string;
  handle: string;
  scrim: string;
}

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  colors: BottomSheetColors;
  heightRatio?: number;
  radius?: number;
  children: React.ReactNode;
}

const DISMISS_VELOCITY = 900;
const DISMISS_FRACTION = 0.3;

/**
 * Gesture-driven sheet that looks and moves identically on iOS and Android.
 * Dragging up past the top rubber-bands; a fast flick or a drag past 30% dismisses.
 */
export function BottomSheet({
  visible,
  onClose,
  colors,
  heightRatio = 0.55,
  radius = 28,
  children,
}: BottomSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetHeight = Math.round(windowHeight * heightRatio) + insets.bottom;
  const hidden = sheetHeight + 24;

  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(hidden);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      translateY.set(withSpring(0, springs.sheet));
    } else {
      translateY.set(withSpring(hidden, springs.sheet, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }));
    }
  }, [hidden, translateY, visible]);

  const pan = Gesture.Pan()
    .onChange((event) => {
      const next = translateY.get() + event.changeY;
      translateY.set(next < 0 ? next * 0.25 : next);
    })
    .onEnd((event) => {
      const shouldClose =
        event.velocityY > DISMISS_VELOCITY || translateY.get() > sheetHeight * DISMISS_FRACTION;
      if (shouldClose) {
        translateY.set(withSpring(hidden, { ...springs.sheet, velocity: event.velocityY }));
        scheduleOnRN(lightImpact);
        scheduleOnRN(onClose);
      } else {
        translateY.set(withSpring(0, { ...springs.snappy, velocity: event.velocityY }));
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, hidden], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              height: sheetHeight + 40,
              marginBottom: -40,
              paddingBottom: insets.bottom + 40,
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
            },
            sheetStyle,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.handle }]} />
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: 10,
    marginBottom: 8,
  },
});
