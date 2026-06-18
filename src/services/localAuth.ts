import * as LocalAuthentication from "expo-local-authentication";

export const localAuth = {
  async checkBiometricAvailability(): Promise<{
    available: boolean;
    types: LocalAuthentication.AuthenticationType[];
  }> {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const types =
      await LocalAuthentication.supportedAuthenticationTypesAsync();
    return { available: compatible && enrolled, types };
  },

  async authenticateWithBiometric(options?: {
    promptMessage?: string;
    cancelLabel?: string;
  }): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: options?.promptMessage ?? "Unlock NomadSafe",
      cancelLabel: options?.cancelLabel ?? "Use PIN",
      disableDeviceFallback: true,
    });
    return result.success;
  },
};
