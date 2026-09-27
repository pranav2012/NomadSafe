import { Stack } from "expo-router";
import { useAuthStore } from "@/features/auth";

export default function AuthLayout() {
  const isSignedIn = useAuthStore((s) => s.isSignedIn);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="setup-pin" />
    </Stack>
  );
}
