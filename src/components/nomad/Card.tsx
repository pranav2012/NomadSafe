import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import type { NomadTheme } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";

interface CardProps {
  children: React.ReactNode;
  theme?: NomadTheme;
  padding?: number;
  style?: StyleProp<ViewStyle>;
}

export function NomadCard({ children, theme: themeProp, padding, style }: CardProps) {
  const { nomad } = useTheme();
  const theme = themeProp ?? nomad.colors;
  const card = nomad.components.card;

  return (
    <View
      style={[
        {
          backgroundColor: theme.paperSoft,
          borderRadius: card.borderRadius,
          padding: padding ?? card.padding,
          borderWidth: 1,
          borderColor: theme.hairline,
          shadowColor: theme.shadow,
          ...nomad.shadows.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
