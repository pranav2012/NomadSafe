import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/atoms/nomad/Icon";
import { PressableScale } from "@/atoms/motion/PressableScale";
import { springs } from "@/atoms/motion/springs";
import { useLocalization } from "@/localization";
import { lightImpact } from "@/utils/haptics";
import { useAura } from "./useAura";

interface AuraSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Right side of the header (e.g. a mic button). */
  headerAction?: React.ReactNode;
  /** Pinned under the content, above the keyboard (e.g. the primary button). */
  footer?: React.ReactNode;
  /** Grows to fit content up to this share of the screen; "full" always uses it. */
  maxHeight?: number;
  full?: boolean;
  children: React.ReactNode;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

/**
 * The one bottom sheet for forms and confirmations, identical on iOS and Android: springs up over
 * a dimmed backdrop, drags down to dismiss from its header, and stays above the keyboard.
 */
export function AuraSheet({ visible, onClose, title, subtitle, headerAction, footer, maxHeight = 0.92, full = false, children }: AuraSheetProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const offset = useSharedValue(height);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      offset.set(height);
      offset.set(withSpring(0, springs.sheet));
    } else {
      offset.set(
        withTiming(height, { duration: 220 }, (finished) => {
          if (finished) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [height, offset, visible]);

  const drag = Gesture.Pan()
    .onChange((event) => {
      offset.set(Math.max(-12, offset.get() + event.changeY));
    })
    .onEnd((event) => {
      if (offset.get() > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(lightImpact);
        scheduleOnRN(onClose);
      } else {
        offset.set(withSpring(0, springs.snappy));
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, offset.get()) }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.get(), [0, height * 0.6], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.avoider} pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              { backgroundColor: c.card, borderColor: c.hairline, maxHeight: height * maxHeight, paddingBottom: insets.bottom + 12 },
              full && { height: height * maxHeight },
              sheetStyle,
            ]}
          >
            <View style={[styles.highlight, { backgroundColor: c.highlight }]} />
            <GestureDetector gesture={drag}>
              <View style={styles.header}>
                <View style={[styles.grabber, { backgroundColor: c.highlight }]} />
                {title ? (
                  <View style={styles.titleRow}>
                    <View style={styles.titleText}>
                      <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
                      {subtitle ? <Text style={[styles.subtitle, { color: c.textMuted, fontFamily: f.regular }]}>{subtitle}</Text> : null}
                    </View>
                    {headerAction}
                    <PressableScale
                      onPress={onClose}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.close")}
                      style={[styles.close, { backgroundColor: c.surfaceStrong }]}
                    >
                      <Icon name="x" size={16} color={c.text} />
                    </PressableScale>
                  </View>
                ) : null}
              </View>
            </GestureDetector>
            <View style={full ? styles.flex : styles.shrink}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { backgroundColor: "rgba(4,5,9,0.55)" },
  avoider: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, overflow: "hidden" },
  highlight: { position: "absolute", top: 0, left: 40, right: 40, height: StyleSheet.hairlineWidth },
  header: { paddingTop: 10, paddingHorizontal: 20, paddingBottom: 6 },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  titleText: { flex: 1 },
  title: { fontSize: 22, letterSpacing: -0.5 },
  subtitle: { fontSize: 13.5, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 10 },
});
