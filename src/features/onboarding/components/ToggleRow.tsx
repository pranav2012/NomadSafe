import React from "react";
import { Pressable } from "react-native";
import type { NomadTheme } from "@/constants/nomadTokens";
import { PermissionRow } from "@/components/nomad/PermissionRow";

interface Props {
  theme: NomadTheme;
  title: string;
  sub: string;
  on: boolean;
  onPress?: () => void;
}

/** PermissionRow exposed to screen readers as a switch with its checked state. */
export function ToggleRow({ theme, title, sub, on, onPress }: Props) {
  const inactive = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={sub}
      accessibilityState={{ checked: on, disabled: inactive }}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      <PermissionRow theme={theme} title={title} sub={sub} on={on} />
    </Pressable>
  );
}
