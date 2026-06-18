import React from "react";
import { View, Pressable, Text, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import type { BottomTabBarProps } from "expo-router/tabs";
import { Icon, type IconName } from "./Icon";
import { getNomadTheme, NOMAD_FONTS } from "@/constants/nomadTokens";
import { useThemeContext } from "@/providers/ThemeProvider";

type TabDef = { route: string; label: string; icon: IconName };

const TAB_DEFS: TabDef[] = [
  { route: "index", label: "Trip", icon: "compass" },
  { route: "sos", label: "Safety", icon: "shield" },
  { route: "sharing", label: "Share", icon: "users" },
  { route: "expenses", label: "Money", icon: "wallet" },
  { route: "ai", label: "AI", icon: "sparkle" },
];

export function NomadTabBar({ state, navigation }: BottomTabBarProps) {
  const { isDark } = useThemeContext();
  const theme = getNomadTheme(isDark);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <BlurView
        tint={isDark ? "dark" : "light"}
        intensity={Platform.OS === "android" ? 80 : 40}
        style={[
          styles.bar,
          {
            backgroundColor: isDark
              ? "rgba(15,21,25,0.78)"
              : "rgba(255,250,240,0.82)",
            borderColor: isDark
              ? "rgba(240,230,214,0.08)"
              : "rgba(26,22,18,0.06)",
          },
        ]}
      >
        {TAB_DEFS.map((t) => {
          const routeIndex = state.routes.findIndex((r) => r.name === t.route);
          if (routeIndex === -1) return null;
          const active = state.index === routeIndex;
          const route = state.routes[routeIndex];
          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!active && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };
          return (
            <Pressable
              key={t.route}
              onPress={onPress}
              style={[
                styles.tab,
                active && {
                  backgroundColor: isDark
                    ? "rgba(224,96,68,0.16)"
                    : theme.stampSoft,
                },
              ]}
            >
              <Icon
                name={t.icon}
                size={21}
                color={active ? theme.stamp : theme.inkMuted}
                strokeWidth={active ? 2.1 : 1.7}
              />
              <Text
                style={[
                  styles.label,
                  { color: active ? theme.stamp : theme.inkMuted },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 28,
  },
  bar: {
    height: 66,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    padding: 6,
    overflow: "hidden",
    shadowColor: "#1A1612",
    shadowOpacity: 0.09,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  tab: {
    flex: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 6,
  },
  label: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 9.5,
    letterSpacing: 0.2,
  },
});
