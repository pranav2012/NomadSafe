import React from "react";
import { Switch as RNSwitch } from "react-native";
import { useTheme } from "@/hooks/useTheme";

interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Switch({ value, onValueChange, disabled = false }: SwitchProps) {
  const { colors } = useTheme();

  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.primaryText}
      ios_backgroundColor={colors.border}
    />
  );
}
