import React from "react";
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "./Button";

interface ModalAction {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  actions?: ModalAction[];
}

export function Modal({
  visible,
  onClose,
  title,
  children,
  actions,
}: ModalProps) {
  const { colors, typography, spacing, radii } = useTheme();

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
          <Pressable
            style={[
              styles.content,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: radii.xl,
                padding: spacing["2xl"],
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {title && (
              <Text
                style={[
                  styles.title,
                  {
                    color: colors.text,
                    fontSize: typography.sizes.xl,
                    fontWeight: typography.weights.semibold,
                    marginBottom: spacing.lg,
                  },
                ]}
              >
                {title}
              </Text>
            )}

            {children}

            {actions && actions.length > 0 && (
              <View style={[styles.actions, { marginTop: spacing["2xl"] }]}>
                {actions.map((action, index) => (
                  <View
                    key={index}
                    style={[
                      styles.actionButton,
                      index > 0 && { marginLeft: spacing.sm },
                    ]}
                  >
                    <Button
                      title={action.title}
                      onPress={action.onPress}
                      variant={action.variant ?? "primary"}
                      fullWidth
                    />
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        </Animated.View>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: { width: "100%", maxWidth: 400 },
  title: {},
  actions: { flexDirection: "row" },
  actionButton: { flex: 1 },
});
