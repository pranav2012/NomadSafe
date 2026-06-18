import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { localAuth } from "@/services/localAuth";

type BiometricKind = "face" | "fingerprint" | "generic";

export interface BiometricPresentation {
  kind: BiometricKind;
  name: string;
  matchedLabel: string;
  setupLabel: string;
  protectedBy: string;
  vaultSummary: string;
  keyStoreName: string;
}

function getPresentation(kind: BiometricKind): BiometricPresentation {
  if (kind === "fingerprint") {
    return {
      kind,
      name: Platform.OS === "ios" ? "Touch ID" : "Fingerprint",
      matchedLabel: "Fingerprint matched",
      setupLabel: "Set up fingerprint",
      protectedBy: "your fingerprint",
      vaultSummary: "Fingerprint · on-device",
      keyStoreName: Platform.OS === "ios" ? "Secure Enclave" : "Android Keystore",
    };
  }

  if (kind === "face") {
    return {
      kind,
      name: "Face ID",
      matchedLabel: "Face ID matched",
      setupLabel: "Set up Face ID",
      protectedBy: "your face",
      vaultSummary: "Face ID · on-device",
      keyStoreName: "Secure Enclave",
    };
  }

  return {
    kind,
    name: "Biometric unlock",
    matchedLabel: "Biometric matched",
    setupLabel: "Set up biometric unlock",
    protectedBy: "your biometrics",
    vaultSummary: "Biometric · on-device",
    keyStoreName: Platform.OS === "ios" ? "Secure Enclave" : "Android Keystore",
  };
}

function getKind(types: LocalAuthentication.AuthenticationType[]): BiometricKind {
  if (Platform.OS === "android") return "fingerprint";
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "face";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "fingerprint";
  return "generic";
}

export function useBiometricPresentation() {
  const [presentation, setPresentation] = useState(() =>
    getPresentation(Platform.OS === "android" ? "fingerprint" : "face"),
  );

  useEffect(() => {
    let mounted = true;

    localAuth.checkBiometricAvailability()
      .then(({ types }) => {
        if (mounted) setPresentation(getPresentation(getKind(types)));
      })
      .catch(() => {
        if (mounted) setPresentation(getPresentation(Platform.OS === "android" ? "fingerprint" : "generic"));
      });

    return () => {
      mounted = false;
    };
  }, []);

  return presentation;
}
