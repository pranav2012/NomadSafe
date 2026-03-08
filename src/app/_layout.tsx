import React, { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { Stack, useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "@/lib/auth-client";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { useAuthStore } from "@/stores/authStore";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

/** Locks the app when returning from background after the configured timeout */
function AppStateLock() {
  const router = useRouter();
  const appState = useRef(AppState.currentState);
  const { isPinSet, isSignedIn, autoLockTimeout, updateLastActive, setUnlocked, lastActiveTimestamp } =
    useAuthStore();

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (appState.current === "active" && nextState.match(/inactive|background/)) {
          updateLastActive();
        }

        if (
          appState.current.match(/inactive|background/) &&
          nextState === "active" &&
          isSignedIn &&
          isPinSet
        ) {
          const elapsed = lastActiveTimestamp ? Date.now() - lastActiveTimestamp : Infinity;
          if (elapsed > autoLockTimeout) {
            setUnlocked(false);
            router.replace("/(auth)/lock-screen");
          }
        }

        appState.current = nextState;
      },
    );

    return () => subscription.remove();
  }, [isPinSet, isSignedIn, autoLockTimeout, lastActiveTimestamp, updateLastActive, setUnlocked, router]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <ThemeProvider>
          <AppStateLock />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </ThemeProvider>
      </ConvexBetterAuthProvider>
    </GestureHandlerRootView>
  );
}
