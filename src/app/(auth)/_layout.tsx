import { Stack } from "expo-router";

// Guarded in the root stack, so signing in leaves the whole group instead of emptying it.
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
