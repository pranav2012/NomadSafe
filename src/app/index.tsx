import { Redirect } from "expo-router";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAuthStore } from "@/stores/authStore";

export default function Index() {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const isPinSet = useAuthStore((s) => s.isPinSet);

  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (isPinSet && !isUnlocked) return <Redirect href="/(auth)/lock-screen" />;
  return <Redirect href="/(tabs)" />;
}
