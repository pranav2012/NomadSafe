import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { BlurTargetView } from "expo-blur";
import { TabList, TabSlot, TabTrigger, Tabs, useTabTrigger } from "expo-router/ui";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassTabBar, type GlassTabItem } from "@/components/tabbar/GlassTabBar";
import { TAB_BAR_GAP, TAB_BAR_HEIGHT, useKeyboardVisible } from "@/components/tabbar/tabBarInset";
import { AURA_FONT_FILES, auraDark, auraLight } from "@/constants/aura";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";

const TABS = [
  { name: "index", href: "/(tabs)", labelKey: "tabs.trip", icon: "compass" },
  { name: "sos", href: "/(tabs)/sos", labelKey: "tabs.safety", icon: "shield" },
  { name: "sharing", href: "/(tabs)/sharing", labelKey: "tabs.share", icon: "users" },
  { name: "expenses", href: "/(tabs)/expenses", labelKey: "tabs.money", icon: "wallet" },
  { name: "ai", href: "/(tabs)/ai", labelKey: "tabs.ai", icon: "sparkle" },
] as const;

/**
 * Headless tabs so the screens can sit inside the Android blur target while the floating glass
 * tab bar sits outside it (a blur view can't sample a target that contains itself).
 */
export default function TabsLayout() {
  const blurTarget = useRef<View>(null);
  return (
    <Tabs style={styles.root}>
      <BlurTargetView ref={blurTarget} style={styles.root}>
        <TabSlot />
      </BlurTargetView>
      <TabList style={styles.hidden}>
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.href} />
        ))}
      </TabList>
      <AppTabBar blurTarget={blurTarget} />
    </Tabs>
  );
}

function AppTabBar({ blurTarget }: { blurTarget: React.RefObject<View | null> }) {
  const { isDark } = useTheme();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const { getTrigger, switchTab } = useTabTrigger({ name: "index" });
  const c = isDark ? auraDark : auraLight;

  const hide = useSharedValue(0);
  useEffect(() => {
    hide.set(withTiming(keyboardVisible ? 1 : 0, { duration: 180 }));
  }, [hide, keyboardVisible]);
  const hideStyle = useAnimatedStyle(() => ({
    opacity: 1 - hide.get(),
    transform: [{ translateY: hide.get() * (TAB_BAR_HEIGHT + 40) }],
  }));

  const items: GlassTabItem[] = TABS.map((tab) => ({ key: tab.name, label: t(tab.labelKey), icon: tab.icon }));
  const activeIndex = Math.max(0, TABS.findIndex((tab) => getTrigger(tab.name)?.isFocused));

  return (
    <Animated.View
      pointerEvents={keyboardVisible ? "none" : "box-none"}
      style={[styles.barWrap, { bottom: insets.bottom + TAB_BAR_GAP }, hideStyle]}
    >
      <GlassTabBar
        items={items}
        activeIndex={activeIndex}
        onChange={(index) => switchTab(TABS[index].name, {})}
        isDark={isDark}
        activeColor={c.text}
        inactiveColor={c.textSoft}
        labelFontSource={AURA_FONT_FILES.InstrumentSans_500Medium}
        blurTarget={blurTarget}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { display: "none" },
  barWrap: { position: "absolute", left: 16, right: 16 },
});
