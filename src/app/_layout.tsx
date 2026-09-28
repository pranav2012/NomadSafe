import React, { useEffect, useRef } from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import { Stack, useRouter, type ErrorBoundaryProps } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import * as Sentry from "@sentry/react-native";
import {
  useFonts as useFraunces,
  Fraunces_500Medium,
  Fraunces_500Medium_Italic,
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist";
import {
  GeistMono_400Regular,
  GeistMono_500Medium,
} from "@expo-google-fonts/geist-mono";
import { api } from "@convex/_generated/api";
import { authClient, useAuthStore, useSyncAuthSession } from "@/features/auth";
import LockScreen from "@/features/auth/screens/LockScreen";
import {
  ensureProvisioned,
  localModelService,
  modelNotifications,
  registerModelDownloadTask,
  useChatStore,
} from "@/features/ai";
import { isLocationBroadcastRunning, useSharingStore } from "@/features/location-sharing";
import { useSafetyNotificationRouting } from "@/features/safety";
import { useSettingsStore } from "@/features/settings";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { LocalizationProvider } from "@/localization";
import { translate } from "@/localization/translate";

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: sentryDsn,
  enabled: !!sentryDsn && !__DEV__,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  // HTTP/console breadcrumbs can carry coordinates or destinations; keep them off.
  beforeBreadcrumb: (breadcrumb) =>
    breadcrumb.category === "fetch" || breadcrumb.category === "xhr" || breadcrumb.category === "console"
      ? null
      : breadcrumb,
});

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
    Sentry.captureException(error);
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

function AppStateLock() {
  const router = useRouter();
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
          }
          return;
        }

        if (nextState !== "active" || prev === "active") return;

        void ensureProvisioned();
        isLocationBroadcastRunning().then((running) => {
          if (running !== useSharingStore.getState().isBroadcasting) {
            useSharingStore.getState().setBroadcasting(running);
          }
        });

        const auth = useAuthStore.getState();
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (!since || !auth.isSignedIn || !auth.isPinSet) return;
        if (Date.now() - since > auth.autoLockTimeout) {
          if (router.canDismiss()) router.dismissAll();
          auth.setUnlocked(false);
        }
      },
    );

    return () => subscription.remove();
  }, [router]);

  return null;
}

/** Renders the lock screen above every route (including native modals). */
function LockGate() {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const locked = onboardingCompleted && isSignedIn && isPinSet && !isUnlocked;

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
    Sentry.setUser({ id: userId });
  }, [claimInvites, isAuthenticated, userId]);

  useEffect(() => {
    if (!userId) Sentry.setUser(null);
  }, [userId]);

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
      <Stack.Protected guard={!onboardingCompleted}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Screen name="(auth)" />
      <Stack.Protected guard={inApp}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        <Stack.Screen name="trips" options={{ presentation: "modal" }} />
        <Stack.Screen name="emergency-contacts" />
      </Stack.Protected>
    </Stack>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFraunces({
    Fraunces_500Medium,
    Fraunces_500Medium_Italic,
    Fraunces_600SemiBold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

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
            <AppStack />
            <LockGate />
          </ThemeProvider>
        </LocalizationProvider>
      </ConvexBetterAuthProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);

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
