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
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { NomadButton } from "@/components/nomad/Button";

interface ModalAction {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

const ACTION_VARIANT = {
  primary: "primary",
  secondary: "secondary",
  ghost: "ghost",
  danger: "stamp",
} as const;

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
  const { nomad, typography, spacing, radii } = useTheme();
  const theme = nomad.colors;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.scrim }]}
        onPress={onClose}
      >
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
          <Pressable
            style={[
              styles.content,
              {
                backgroundColor: theme.paper,
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
                    color: theme.inkDeep,
                    fontFamily: NOMAD_FONTS.display,
                    fontSize: typography.sizes.xl,
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
                    <NomadButton
                      onPress={action.onPress}
                      variant={ACTION_VARIANT[action.variant ?? "primary"]}
                      theme={theme}
                      full
                    >
                      {action.title}
                    </NomadButton>
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
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: { width: "100%", maxWidth: 400 },
  title: {},
  actions: { flexDirection: "row" },
  actionButton: { flex: 1 },
});
