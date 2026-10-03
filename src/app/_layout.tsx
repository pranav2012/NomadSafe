import React, { useEffect, useRef } from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import { Stack, usePathname, useRouter, useSegments, type ErrorBoundaryProps } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { useFonts } from "expo-font";
import { api } from "@convex/_generated/api";
import { AURA_FONT_FILES } from "@/constants/aura";
import { authClient, useAuthStore, useSyncAuthSession } from "@/features/auth";
import LockScreen from "@/features/auth/screens/LockScreen";
import {
  ensureProvisioned,
  localModelService,
  modelNotifications,
  registerModelDownloadTask,
  useChatStore,
} from "@/features/ai";
import { enforceBroadcastLimits, isLocationBroadcastRunning, readBroadcastState, useSharingStore } from "@/features/location-sharing";
import { useSafetyNotificationRouting } from "@/features/safety";
import { useSettingsStore } from "@/features/settings";
import {
  isCaptureLinkRecent,
  isVoiceCaptureRoute,
} from "@/features/expenses/services/voiceCaptureSession";
import { WidgetSync } from "@/features/widget/WidgetSync";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { LocalizationProvider } from "@/localization";
import { translate } from "@/localization/translate";
import {
  identifyUser,
  resetAnalytics,
  setAnalyticsEnabled,
  setReplayRecording,
  trackScreen,
} from "@/services/analytics";
import { logger } from "@/services/logger";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_URL. Add it to your .env.local file.",
  );
}

const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    logger.error("error-boundary", "render crashed", error);
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

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        const prev = appState.current;
        appState.current = nextState;

        // iOS goes active → inactive → background, so key off "background" alone.
        if (nextState === "background" && backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
          useAuthStore.getState().updateLastActive();
          // Keep the model loaded if a chat reply is still streaming; the chat
          // store releases it once the reply finishes (and notifies the user).
          if (!useChatStore.getState().generatingConversationKey) {
            localModelService.release();
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

        void ensureProvisioned();
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
        if (!since || !auth.isSignedIn || !auth.isPinSet) return;
        if (Date.now() - since > auth.autoLockTimeout) {
          // A widget "Speak" tap opens the capture screen, which works while locked.
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
 * Renders the lock screen above every route (including native modals). The
 * voice capture screen is the exception: it only adds expenses, so it works locked.
 */
function LockGate() {
  const pathname = usePathname();
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const locked =
    onboardingCompleted && isSignedIn && isPinSet && !isUnlocked && !isVoiceCaptureRoute(pathname);

  return (
    <Modal
      visible={locked}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {}}
    >
      <LockScreen />
    </Modal>
  );
}

function SessionEffects() {
  const { isAuthenticated } = useConvexAuth();
  const claimInvites = useMutation(api.sharing.claimInvites);
  const userId = useAuthStore((s) => s.user?.id);

  useSafetyNotificationRouting();

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

/** Screen tracking by route pattern (no IDs), the analytics opt-out, and pausing replay during PIN entry. */
function AnalyticsEffects() {
  const segments = useSegments();
  const route = "/" + segments.join("/");
  const analyticsEnabled = useSettingsStore((s) => s.analyticsEnabled);
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const locked = onboardingCompleted && isSignedIn && isPinSet && !isUnlocked;
  // Replay stays off while locked, during PIN setup and on voice capture (spoken content).
  const pinScreen = locked || route.endsWith("/setup-pin") || isVoiceCaptureRoute(route);

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

/**
 * Protected groups drop onboarding/sign-in from history once they no longer
 * apply (so Back can't return to them) and keep signed-in screens unreachable
 * after sign-out.
 */
function AppStack() {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const inApp = onboardingCompleted && isSignedIn;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={isSignedIn && !onboardingCompleted}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Screen name="(auth)" />
      <Stack.Protected guard={inApp}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        <Stack.Screen name="trips" options={{ presentation: "modal" }} />
        <Stack.Screen name="emergency-contacts" />
        <Stack.Screen
          name="voice-expense"
          options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
        />
      </Stack.Protected>
    </Stack>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts(AURA_FONT_FILES);

  useSyncAuthSession();

  // Provision the device-matched model (resuming any download from a previous
  // session), wire up the background task, and prepare download notifications.
  useEffect(() => {
    modelNotifications.configure();
    registerModelDownloadTask();
    void ensureProvisioned();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <LocalizationProvider>
          <ThemeProvider>
            <AppStateLock />
            <SessionEffects />
            <AnalyticsEffects />
            <WidgetSync />
            <AppStack />
            <LockGate />
          </ThemeProvider>
        </LocalizationProvider>
      </ConvexBetterAuthProvider>
    </GestureHandlerRootView>
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
