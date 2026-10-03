import React from "react";
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { useAura } from "./useAura";

export type AuraButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface AuraButtonProps {
  label: string;
  onPress?: () => void;
  variant?: AuraButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const DANGER = "#FF4D5E";

export function AuraButton({ label, onPress, variant = "primary", icon, loading, disabled, size = "lg", style, accessibilityHint }: AuraButtonProps) {
  const { c, f } = useAura();
  const palette = {
    primary: { bg: c.inverse, fg: c.onInverse },
    secondary: { bg: c.surfaceStrong, fg: c.text },
    danger: { bg: DANGER, fg: "#FFFFFF" },
    ghost: { bg: "transparent", fg: c.textSoft },
  }[variant];
  const inactive = disabled || loading;

  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      pressedScale={0.97}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[styles.base, size === "lg" ? styles.lg : styles.md, { backgroundColor: palette.bg, opacity: disabled ? 0.4 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === "lg" ? 18 : 15} color={palette.fg} strokeWidth={2} /> : null}
          <Text style={[size === "lg" ? styles.labelLg : styles.labelMd, { color: palette.fg, fontFamily: f.semibold }]}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999 },
  lg: { height: 54, paddingHorizontal: 22 },
  md: { height: 38, paddingHorizontal: 14 },
  labelLg: { fontSize: 16 },
  labelMd: { fontSize: 13.5 },
});
