import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { withSystemPrompt } from "@/utils/systemPrompt";

export type DeviceAuthResult = "ok" | "cancelled" | "noScreenLock" | "failed";

// AndroidX can't combine strong biometrics with the device credential before Android 11.
const ANDROID_STRONG_WITH_CREDENTIAL = 30;

export const localAuth = {
  /** Whether the phone has a screen lock (PIN, pattern, passcode or biometrics) the app lock can use. */
  async hasScreenLock(): Promise<boolean> {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  },

  async biometricTypes(): Promise<LocalAuthentication.AuthenticationType[]> {
    return LocalAuthentication.supportedAuthenticationTypesAsync();
  },

  /** The phone's own unlock prompt: biometrics, with the phone's PIN/pattern/passcode as the fallback. */
  async authenticate(promptMessage: string): Promise<DeviceAuthResult> {
    const result = await withSystemPrompt(() =>
      LocalAuthentication.authenticateAsync({
        promptMessage,
        disableDeviceFallback: false,
        requireConfirmation: false,
        biometricsSecurityLevel:
          Platform.OS === "android" && Number(Platform.Version) < ANDROID_STRONG_WITH_CREDENTIAL ? "weak" : "strong",
      }),
    );
    if (result.success) return "ok";
    switch (result.error) {
      case "passcode_not_set":
      case "not_enrolled":
        return (await localAuth.hasScreenLock()) ? "failed" : "noScreenLock";
      case "user_cancel":
      case "system_cancel":
      case "app_cancel":
        return "cancelled";
      default:
        return "failed";
    }
  },
};
