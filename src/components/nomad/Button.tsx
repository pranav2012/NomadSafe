import React from "react";
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";

type Variant = "primary" | "secondary" | "teal" | "stamp" | "ghost";

interface ButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: Variant;
  theme: NomadTheme;
  icon?: React.ReactNode;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function NomadButton({
  children,
  onPress,
  variant = "primary",
  theme,
  icon,
  full,
  style,
}: ButtonProps) {
  const variants = {
    primary: {
      bg: theme.inkDeep,
      fg: theme.paperSoft,
      border: theme.inkDeep,
    },
    secondary: {
      bg: "transparent",
      fg: theme.inkDeep,
      border: theme.inkDeep,
    },
    teal: { bg: theme.teal, fg: "#fff", border: theme.teal },
    stamp: { bg: theme.stamp, fg: "#fff", border: theme.stamp },
    ghost: {
      bg: theme.paperSoft,
      fg: theme.inkDeep,
      border: theme.hairline,
    },
  } as const;
  const v = variants[variant];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          width: full ? "100%" : undefined,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ? <View style={{ marginRight: 8 }}>{icon}</View> : null}
        <Text style={[styles.label, { color: v.fg }]}>{children}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
    letterSpacing: -0.15,
  },
});
