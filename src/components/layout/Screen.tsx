import React from "react";
import {
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  keyboardAvoiding?: boolean;
  edges?: Edge[];
  padding?: boolean;
}

export function Screen({
  children,
  scroll = false,
  keyboardAvoiding = false,
  edges = ["top"],
  padding = true,
}: ScreenProps) {
  const { colors, spacing } = useTheme();

  const content = (
    <View
      style={[styles.inner, padding && { paddingHorizontal: spacing.lg }]}
    >
      {children}
    </View>
  );

  const scrollContent = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {content}
    </ScrollView>
  ) : (
    content
  );

  const keyboardContent = keyboardAvoiding ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {scrollContent}
    </KeyboardAvoidingView>
  ) : (
    scrollContent
  );

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      {keyboardContent}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inner: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
