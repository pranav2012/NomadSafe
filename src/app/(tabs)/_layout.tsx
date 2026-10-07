import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { BlurTargetView } from "expo-blur";
import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { TabList, TabSlot, TabTrigger, Tabs, defaultTabsSlotRender, useTabTrigger, type TabsSlotRenderOptions } from "expo-router/ui";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassTabBar, type GlassTabItem, TAB_BAR_GAP, TAB_BAR_HEIGHT, useKeyboardVisible } from "@/atoms";
import { AURA_FONT_FILES, auraDark, auraLight } from "@/constants/aura";
import { usePendingJoinStore } from "@/features/trips/store/pendingJoinStore";
import { useAuthStore } from "@/features/auth";
import { useIncomingShareStore } from "@/features/itinerary/store/incomingShareStore";
import { useTripGmailSync } from "@/features/expenses/hooks/useTripGmailSync";
import { useLandingTab } from "@/features/home/hooks/useLandingTab";
import { useRecurringRunner } from "@/features/expenses/hooks/useRecurringRunner";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";

const TABS = [
  { name: "index", href: "/(tabs)", labelKey: "tabs.trip", icon: "compass", sf: "safari", sfSelected: "safari.fill" },
  { name: "sos", href: "/(tabs)/sos", labelKey: "tabs.safety", icon: "shield", sf: "shield", sfSelected: "shield.fill" },
  { name: "expenses", href: "/(tabs)/expenses", labelKey: "tabs.money", icon: "wallet", sf: "wallet.pass", sfSelected: "wallet.pass.fill" },
  { name: "ai", href: "/(tabs)/ai", labelKey: "tabs.ai", icon: "sparkle", sf: "sparkles", sfSelected: "sparkles" },
] as const;

export default function TabsLayout() {
  usePendingInvite();
  usePendingShare();
  useTripGmailSync();
  useLandingTab();
  useRecurringRunner();
  return Platform.OS === "ios" ? <NativeTabsLayout /> : <GlassTabsLayout />;
}

/** Opens the join screen for an invite link that arrived before the user was in the app. */
function usePendingInvite() {
  const router = useRouter();
  const code = usePendingJoinStore((s) => s.code);
  useEffect(() => {
    if (!code) return;
    const { deferred } = usePendingJoinStore.getState();
    usePendingJoinStore.getState().setCode(null);
    router.push({ pathname: "/join/[code]", params: deferred ? { code, deferred: "1" } : { code } });
  }, [code, router]);
}

// Lets the lock gate's modal (privacy cover or lock screen) finish closing first: iOS can't present
// "Save idea" while another presentation is still on its way out, and shows a blank sheet instead.
const SHARE_OPEN_DELAY_MS = 450;

/** Opens "Save idea" for a link shared from another app once the user is in the app, active and unlocked. */
function usePendingShare() {
  const router = useRouter();
  const text = useIncomingShareStore((s) => s.text);
  const unlocked = useAuthStore((s) => !s.lockEnabled || s.isUnlocked);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!text || !unlocked || !active) return;
    const timer = setTimeout(() => {
      const shared = useIncomingShareStore.getState().take();
      if (shared) router.push({ pathname: "/save-link", params: { text: shared } });
    }, SHARE_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, text, unlocked, router]);
}

/** The system UITabBar (Liquid Glass on iOS 26), minimizing while scrolling down. */
function NativeTabsLayout() {
  const { isDark } = useTheme();
  const { t } = useLocalization();
  const c = isDark ? auraDark : auraLight;
  return (
    <NativeTabs tintColor={c.text} minimizeBehavior="onScrollDown">
      {TABS.map((tab) => (
        // Screens pad themselves from the safe area (the globe hero runs under the status bar).
        <NativeTabs.Trigger key={tab.name} name={tab.name} disableAutomaticContentInsets>
          <NativeTabs.Trigger.Label>{t(tab.labelKey)}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: tab.sf, selected: tab.sfSelected }} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

/**
 * Headless tabs so the screens can sit inside the Android blur target while the floating glass
 * tab bar sits outside it (a blur view can't sample a target that contains itself).
 */
function GlassTabsLayout() {
  const blurTarget = useRef<View>(null);
  const { isDark } = useTheme();
  return (
    <Tabs style={[styles.root, { backgroundColor: (isDark ? auraDark : auraLight).bg }]}>
      <BlurTargetView ref={blurTarget} style={styles.root}>
        <TabSlot renderFn={renderFrozenWhenHidden} />
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

// Hidden tabs stay mounted; freezing them stops their React updates (Convex data, timers) from
// re-rendering offscreen screens while another tab is scrolling.
function renderFrozenWhenHidden(descriptor: Parameters<typeof defaultTabsSlotRender>[0], options: TabsSlotRenderOptions) {
  return defaultTabsSlotRender({ ...descriptor, options: { ...descriptor.options, freezeOnBlur: true } }, options);
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
