import { Redirect } from "expo-router";
import { useSettingsStore } from "@/features/settings";
import { useAuthStore } from "@/features/auth";

export default function Index() {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);

  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;
  return <Redirect href="/(tabs)" />;
}
