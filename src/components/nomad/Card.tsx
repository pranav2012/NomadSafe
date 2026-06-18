import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import type { NomadTheme } from "@/constants/nomadTokens";

interface CardProps {
  children: React.ReactNode;
  theme: NomadTheme;
  padding?: number;
  style?: StyleProp<ViewStyle>;
}

export function NomadCard({ children, theme, padding = 18, style }: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.paperSoft,
          borderRadius: 18,
          padding,
          borderWidth: 1,
          borderColor: theme.hairline,
          shadowColor: "#1A1612",
          shadowOpacity: 0.04,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
