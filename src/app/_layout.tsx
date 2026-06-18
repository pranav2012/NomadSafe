import React, { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { Stack, useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
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
import { authClient } from "@/lib/auth-client";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { useAuthStore } from "@/stores/authStore";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

function AppStateLock() {
  const router = useRouter();
  const appState = useRef(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);
  const { isPinSet, isSignedIn, autoLockTimeout, updateLastActive, setUnlocked, lastActiveTimestamp } =
    useAuthStore();

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (appState.current === "active" && nextState === "background") {
          backgroundedAt.current = Date.now();
          updateLastActive();
        }

        if (
          appState.current === "background" &&
          nextState === "active" &&
          isSignedIn &&
          isPinSet
        ) {
          const lastActive = backgroundedAt.current ?? lastActiveTimestamp;
          const elapsed = lastActive ? Date.now() - lastActive : Infinity;
          backgroundedAt.current = null;
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

  if (!fontsLoaded) return null;

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
            <Stack.Screen name="settings" options={{ presentation: "modal" }} />
            <Stack.Screen name="trips" options={{ presentation: "modal" }} />
          </Stack>
        </ThemeProvider>
      </ConvexBetterAuthProvider>
    </GestureHandlerRootView>
  );
}
