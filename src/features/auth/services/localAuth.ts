import * as LocalAuthentication from "expo-local-authentication";
import { withSystemPrompt } from "@/utils/systemPrompt";

export const localAuth = {
  /** Available only with Class 3 (strong) biometrics enrolled; weak face unlock doesn't count. */
  async checkBiometricAvailability(): Promise<{
    available: boolean;
    types: LocalAuthentication.AuthenticationType[];
  }> {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    const types =
      await LocalAuthentication.supportedAuthenticationTypesAsync();
    return { available: compatible && level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG, types };
  },

  async authenticateWithBiometric(options?: {
    promptMessage?: string;
    cancelLabel?: string;
  }): Promise<boolean> {
    const result = await withSystemPrompt(() =>
      LocalAuthentication.authenticateAsync({
        promptMessage: options?.promptMessage ?? "Unlock NomadSafe",
        cancelLabel: options?.cancelLabel ?? "Use PIN",
        disableDeviceFallback: true,
        biometricsSecurityLevel: "strong",
      }),
    );
    return result.success;
  },
};
