import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTheme } from "@/hooks/useTheme";
import { SCREEN_HEIGHT } from "@/constants/layout";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoints?: number[];
  title?: string;
}

const SPRING_CONFIG = { damping: 20, stiffness: 150 };

export function BottomSheet({
  visible,
  onClose,
  children,
  snapPoints = [0.5],
  title,
}: BottomSheetProps) {
  const { colors, typography, spacing, radii } = useTheme();

  const sheetHeight = SCREEN_HEIGHT * snapPoints[0];
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);
  const context = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, SPRING_CONFIG);
      backdropOpacity.value = withTiming(1, { duration: 200 });
    } else {
      translateY.value = withSpring(sheetHeight, SPRING_CONFIG);
      backdropOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [visible, sheetHeight, translateY, backdropOpacity]);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      context.value = translateY.value;
    })
    .onUpdate((event) => {
      translateY.value = Math.max(0, context.value + event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > sheetHeight * 0.3 || event.velocityY > 500) {
        translateY.value = withSpring(sheetHeight, SPRING_CONFIG);
        backdropOpacity.value = withTiming(0, { duration: 200 });
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, SPRING_CONFIG);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor: colors.surfaceElevated,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
            },
            sheetStyle,
          ]}
        >
          <View style={styles.handleContainer}>
            <View
              style={[styles.handle, { backgroundColor: colors.border }]}
            />
          </View>

          {title && (
            <Text
              style={[
                styles.title,
                {
                  color: colors.text,
                  fontSize: typography.sizes.lg,
                  fontWeight: typography.weights.semibold,
                  paddingHorizontal: spacing.lg,
                  marginBottom: spacing.lg,
                },
              ]}
            >
              {title}
            </Text>
          )}

          <View style={{ flex: 1, paddingHorizontal: spacing.lg }}>
            {children}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  title: {},
});
