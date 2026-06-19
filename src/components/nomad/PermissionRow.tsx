import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Icon } from "./Icon";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";

interface PermissionRowProps {
  theme?: NomadTheme;
  title: string;
  sub: string;
  on: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export function PermissionRow({ theme: themeProp, title, sub, on, disabled, onPress }: PermissionRowProps) {
  const { nomad } = useTheme();
  const theme = themeProp ?? nomad.colors;

  const Root = onPress ? Pressable : View;

  return (
    <Root
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }: { pressed?: boolean }) => [
        styles.root,
        {
          backgroundColor: theme.paperSoft,
          borderColor: theme.hairline,
          opacity: disabled ? 0.6 : pressed ? 0.9 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.iconBox,
          { backgroundColor: on ? theme.tealSoft : theme.hairline },
        ]}
      >
        <Icon
          name={on ? "check" : "plus"}
          size={16}
          color={on ? theme.teal : theme.inkMuted}
          strokeWidth={2.4}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: theme.inkDeep }]}>{title}</Text>
        <Text style={[styles.sub, { color: theme.inkSoft }]}>{sub}</Text>
      </View>
      <View
        style={[
          styles.track,
          { backgroundColor: on ? theme.teal : theme.hairline },
        ]}
      >
        <View
          style={[
            styles.knob,
            {
              left: on ? 20 : 2,
              backgroundColor: theme.inverse,
              shadowColor: theme.black,
            },
          ]}
        />
      </View>
    </Root>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  sub: {
    fontSize: 11.5,
    fontFamily: NOMAD_FONTS.ui,
    marginTop: 1,
  },
  track: {
    width: 42,
    height: 24,
    borderRadius: 999,
    position: "relative",
  },
  knob: {
    position: "absolute",
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
