import React, { useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
  Stack,
  usePathname,
  useRouter,
  useSegments,
  type ErrorBoundaryProps,
} from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { api, BackendProvider, useConvexAuth, useMutation } from "@/modules/backend";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { registerGroupPush, startGroupSync, startSync, stopGroupSync, stopSync, useGroupNotificationRouting } from "@/features/sync";
import { AURA_FONT_FILES, auraDark, auraLight } from "@/constants/aura";
import { PrivacyCover, useAuthStore, usePrivacyShield, useSyncAuthSession } from "@/features/auth";
import LockScreen from "@/features/auth/screens/LockScreen";
import { useChatStore } from "@/features/ai";
import { aiRuntime, modelNotifications } from "@/modules/ai";
import { enforceBroadcastLimits, isLocationBroadcastRunning, readBroadcastState, useSharingStore } from "@/features/location-sharing";
import { isSosRoute, useQuickSosStore, useSafetyNotificationRouting, useSafetyServerSync, useSafetyStore } from "@/features/safety";
import { useSettingsStore } from "@/features/settings";
import {
  isCaptureLinkRecent,
  isVoiceCaptureRoute,
} from "@/features/expenses/services/voiceCaptureSession";
import { checkDeferredInvite } from "@/features/trips/services/deferredInvite";
import { WidgetSync } from "@/features/widget/WidgetSync";
import { BillingEffects } from "@/modules/billing";
import { useRecapEffects } from "@/features/recap";
import { SavedIdeasSheet } from "@/features/itinerary";
import { AndroidShareIntake } from "@/features/itinerary/components/AndroidShareIntake";
import { useBoundaryViewSync } from "@/features/passport";
import { AdsEffects } from "@/modules/ads";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { useTheme } from "@/hooks/useTheme";
import { LocalizationProvider } from "@/localization";
import { translate } from "@/localization/translate";
import {
  identifyUser,
  resetAnalytics,
  setAnalyticsEnabled,
  setReplayRecording,
  trackScreen,
} from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { AuraAlertHost, AuraSplash } from "@/atoms";

// Hidden once AuraSplash has drawn the same logo on top (see RootLayout).
SplashScreen.preventAutoHideAsync().catch(() => {});

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    logger.error("error-boundary", "render crashed", error);
    SplashScreen.hide();
  }, [error]);

  return (
    <View style={styles.errorRoot}>
      <Text style={styles.errorTitle}>{translate("errors.crashTitle")}</Text>
      <Text style={styles.errorBody}>{translate("errors.crashBody")}</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.errorButton}>
        <Text style={styles.errorButtonText}>{translate("errors.tryAgain")}</Text>
      </Pressable>
    </View>
  );
}

const BACKGROUND_REPLY_LIMIT_MS = 30_000;

function AppStateLock() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const appState = useRef(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);
  const backgroundedAtMono = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        const prev = appState.current;
        appState.current = nextState;

        // iOS goes active → inactive → background, so key off "background" alone.
        if (nextState === "background" && backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
          backgroundedAtMono.current = performance.now();
          useAuthStore.getState().updateLastActive();
          // Keep the model loaded if a chat reply is still streaming; the chat
          // store releases it once the reply finishes (and notifies the user).
          if (!useChatStore.getState().generatingConversationKey) {
            aiRuntime.release();
          } else {
            // Android keeps running in the background, so cap how long a reply may keep the CPU/GPU busy.
            setTimeout(() => {
              if (AppState.currentState !== "active" && useChatStore.getState().generatingConversationKey) {
                useChatStore.getState().stop();
              }
            }, BACKGROUND_REPLY_LIMIT_MS);
          }
          return;
        }

        if (nextState !== "active" || prev === "active") return;

        void aiRuntime.ensureProvisioned();
        // Apply share expiry and the emergency time limit, then mirror the task's state in the UI store.
        void enforceBroadcastLimits()
          .then(() => isLocationBroadcastRunning())
          .then((running) => {
            const sharing = useSharingStore.getState();
            if (running !== sharing.isBroadcasting) sharing.setBroadcasting(running);
            const { mode } = readBroadcastState();
            if (running && mode !== sharing.mode) sharing.setMode(mode);
          });

        const auth = useAuthStore.getState();
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (!since || !auth.isSignedIn || !auth.lockEnabled) return;
        // The wall clock can be moved back; the monotonic clock may pause while the phone sleeps.
        const wallElapsed = Date.now() - since;
        const monoElapsed = performance.now() - backgroundedAtMono.current;
        if (wallElapsed < 0 || Math.max(wallElapsed, monoElapsed) > auth.autoLockTimeout) {
          // Widget taps open voice capture or the SOS countdown, which work while locked.
          const capturing = isVoiceCaptureRoute(pathnameRef.current) || isCaptureLinkRecent();
          if (router.canDismiss() && !capturing) router.dismissAll();
          auth.setUnlocked(false);
        }
      },
    );

    return () => subscription.remove();
  }, [router]);

  return null;
}

/**
 * Whether the lock screen should cover the app. Two exceptions work locked: voice capture
 * (it only adds expenses) and the Safety tab while an SOS is counting down or active
 * (it shows only the SOS takeover, never trip data).
 */
function useLockRequired() {
  const pathname = usePathname();
  const sosStatus = useSafetyStore((s) => s.status);
  const sosArming = useQuickSosStore((s) => s.arming);
  const sosOnScreen = isSosRoute(pathname) && (sosStatus === "emergency" || sosArming);
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const lockEnabled = useAuthStore((s) => s.lockEnabled);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  return onboardingCompleted && isSignedIn && lockEnabled && !isUnlocked && !isVoiceCaptureRoute(pathname) && !sosOnScreen;
}

/**
 * Renders the lock screen above every route (including native modals); at launch it fades in over the splash.
 * The same modal carries the iOS app-switcher cover, so going from cover to lock screen never re-presents it.
 */
function LockGate({ fadeIn, onShow }: { fadeIn: boolean; onShow: () => void }) {
  const locked = useLockRequired();
  const shielded = usePrivacyShield();

  return (
    <Modal
      visible={locked || shielded}
      animationType={fadeIn ? "fade" : "none"}
      onShow={onShow}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {}}
    >
      {locked ? <LockScreen /> : <PrivacyCover />}
    </Modal>
  );
}

/** Starts ads (free plan) only once the user is in the app, unlocked and not on a safety or capture screen. */
function AdsGate() {
  const pathname = usePathname();
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const lockEnabled = useAuthStore((s) => s.lockEnabled);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const sosActive = useSafetyStore((s) => s.status === "emergency");
  const sosArming = useQuickSosStore((s) => s.arming || s.requestedAt !== null);
  const ready =
    onboardingCompleted &&
    isSignedIn &&
    (!lockEnabled || isUnlocked) &&
    !sosActive &&
    !sosArming &&
    !isSosRoute(pathname) &&
    !isVoiceCaptureRoute(pathname);

  return <AdsEffects ready={ready} />;
}

/** Backs up trips while signed in with backup on, and keeps shared trips live while signed in. */
function BackupEffects() {
  const { isAuthenticated } = useConvexAuth();
  const userId = useAuthStore((s) => s.user?.id);
  const enabled = useSettingsStore((s) => s.cloudBackupEnabled);

  useEffect(() => {
    if (isAuthenticated && userId && enabled) startSync(userId);
    else stopSync();
  }, [enabled, isAuthenticated, userId]);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      stopGroupSync();
      return;
    }
    startGroupSync(userId);
    void registerGroupPush(false);
  }, [isAuthenticated, userId]);

  return null;
}

function SessionEffects() {
  const { isAuthenticated } = useConvexAuth();
  const claimInvites = useMutation(api.sharing.claimInvites);
  const userId = useAuthStore((s) => s.user?.id);

  useSafetyNotificationRouting();
  useSafetyServerSync();
  useGroupNotificationRouting();
  useRecapEffects();
  useBoundaryViewSync();

  useEffect(() => {
    void checkDeferredInvite();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    claimInvites({}).catch(() => {});
    identifyUser(userId);
  }, [claimInvites, isAuthenticated, userId]);

  const previousUserId = useRef(userId);
  useEffect(() => {
    // Only reset on an actual sign-out, so signed-out launches keep one anonymous ID.
    if (previousUserId.current && !userId) resetAnalytics();
    previousUserId.current = userId;
  }, [userId]);

  return null;
}

/** Screen tracking by route pattern (no IDs), the analytics opt-out, and pausing replay while locked. */
function AnalyticsEffects() {
  const segments = useSegments();
  const route = "/" + segments.join("/");
  const analyticsEnabled = useSettingsStore((s) => s.analyticsEnabled);
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const lockEnabled = useAuthStore((s) => s.lockEnabled);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const locked = onboardingCompleted && isSignedIn && lockEnabled && !isUnlocked;
  // Replay stays off while locked and on voice capture (spoken content).
  const pinScreen = locked || isVoiceCaptureRoute(route);

  useEffect(() => {
    setAnalyticsEnabled(analyticsEnabled);
  }, [analyticsEnabled]);

  useEffect(() => {
    trackScreen(route);
  }, [route]);

  useEffect(() => {
    setReplayRecording(analyticsEnabled && !pinScreen);
  }, [analyticsEnabled, pinScreen]);

  return null;
}

// iOS shows "modal" as a stacked page sheet; open these as full pages there, like Android does.
const PAGE_OPTIONS = Platform.OS === "ios" ? {} : ({ presentation: "modal" } as const);

/**
 * Protected groups drop onboarding/sign-in from history once they no longer
 * apply (so Back can't return to them) and keep signed-in screens unreachable
 * after sign-out.
 */
function AppStack() {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const inApp = onboardingCompleted && isSignedIn;
  const { isDark } = useTheme();
  // Screen containers default to React Navigation's light grey, which flashes white before a screen paints.
  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: (isDark ? auraDark : auraLight).bg } };

  return (
    <NavigationThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={isSignedIn && !onboardingCompleted}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Screen name="(auth)" />
        <Stack.Protected guard={inApp}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={PAGE_OPTIONS} />
          <Stack.Screen name="trips" options={PAGE_OPTIONS} />
          <Stack.Screen name="passport" options={PAGE_OPTIONS} />
          <Stack.Screen name="plan-trip" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen name="join/[code]" options={PAGE_OPTIONS} />
          <Stack.Screen name="paywall" options={PAGE_OPTIONS} />
          <Stack.Screen name="circle" />
          <Stack.Screen name="trip-recap/[id]" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen name="ticket/[eventId]" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen name="receive-ticket" options={PAGE_OPTIONS} />
          <Stack.Screen name="save-link" options={PAGE_OPTIONS} />
          <Stack.Screen name="idea/[eventId]" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen
            name="voice-expense"
            options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
          />
        </Stack.Protected>
      </Stack>
      {inApp ? <SavedIdeasSheet /> : null}
      {Platform.OS === "android" ? <AndroidShareIntake /> : null}
    </NavigationThemeProvider>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts(AURA_FONT_FILES);
  const [splashVisible, setSplashVisible] = useState(true);
  const [lockShown, setLockShown] = useState(false);
  const [splashDrawn, setSplashDrawn] = useState(false);
  const lockRequired = useLockRequired();
  // When locked, the splash waits for the lock screen to cover it, so the app is never seen unlocked.
  const appReady = fontsLoaded && (!lockRequired || lockShown);

  useSyncAuthSession();

  // Expo Router shows nothing until the Stack mounts (after fonts), so the native splash stays until then.
  useEffect(() => {
    if (fontsLoaded && splashDrawn) SplashScreen.hide();
  }, [fontsLoaded, splashDrawn]);

  // Provision the device-matched model (resuming any download from a previous
  // session), wire up the background task, and prepare download notifications.
  useEffect(() => {
    modelNotifications.configure();
    aiRuntime.registerBackgroundDownload();
    void aiRuntime.ensureProvisioned();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {fontsLoaded ? <AppTree splashVisible={splashVisible} onLockShown={() => setLockShown(true)} /> : null}
      {splashVisible ? (
        <AuraSplash ready={appReady} onFirstFrame={() => setSplashDrawn(true)} onDone={() => setSplashVisible(false)} />
      ) : null}
    </GestureHandlerRootView>
  );
}

function AppTree({ splashVisible, onLockShown }: { splashVisible: boolean; onLockShown: () => void }) {
  return (
    <BackendProvider>
      <LocalizationProvider>
        <ThemeProvider>
          <AppStateLock />
          <SessionEffects />
          <BackupEffects />
          <BillingEffects />
          <AdsGate />
          <AnalyticsEffects />
          <WidgetSync />
          <AppStack />
          <LockGate fadeIn={splashVisible} onShow={onLockShown} />
          <AuraAlertHost />
        </ThemeProvider>
      </LocalizationProvider>
    </BackendProvider>
  );
}

export default RootLayout;

const styles = StyleSheet.create({
  errorRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: "#FAF7F2",
  },
  errorTitle: { fontSize: 22, fontWeight: "600", color: "#1D2327", textAlign: "center" },
  errorBody: { fontSize: 15, lineHeight: 22, color: "#5F6B72", textAlign: "center", marginTop: 10 },
  errorButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: "#1D4D4F",
  },
  errorButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
