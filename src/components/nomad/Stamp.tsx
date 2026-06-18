import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";

interface StampProps {
  label: string;
  sub: string;
  rot?: number;
  color?: string;
  size?: number;
}

export function Stamp({
  label,
  sub,
  rot = -8,
  color,
  size = 92,
}: StampProps) {
  const { nomad } = useTheme();
  const stampColor = color ?? nomad.colors.stamp;

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: stampColor,
          transform: [{ rotate: `${rot}deg` }],
        },
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            borderRadius: (size - 8) / 2,
            borderColor: stampColor,
          },
        ]}
      />
      <Text style={[styles.sub, { color: stampColor }]}>{sub}</Text>
      <Text style={[styles.label, { color: stampColor, fontSize: size * 0.26 }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  inner: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderWidth: 1.5,
    opacity: 0.6,
  },
  sub: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    opacity: 0.75,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  label: {
    fontFamily: NOMAD_FONTS.displayItalic,
    lineHeight: undefined,
    fontStyle: "italic",
    fontWeight: "500",
    marginTop: 3,
  },
});
