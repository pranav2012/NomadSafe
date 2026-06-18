import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { localAuth } from "@/features/auth";
import { useLocalization } from "@/localization";

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

function getPresentation(
  kind: BiometricKind,
  t: ReturnType<typeof useLocalization>["t"],
): BiometricPresentation {
  if (kind === "fingerprint") {
    return {
      kind,
      name: Platform.OS === "ios" ? t("biometric.touchId") : t("biometric.fingerprint"),
      matchedLabel: t("biometric.fingerprintMatched"),
      setupLabel: t("biometric.setupFingerprint"),
      protectedBy: t("biometric.yourFingerprint"),
      vaultSummary: t("biometric.fingerprintVaultSummary"),
      keyStoreName: Platform.OS === "ios" ? t("biometric.secureEnclave") : t("biometric.androidKeystore"),
    };
  }

  if (kind === "face") {
    return {
      kind,
      name: t("biometric.faceId"),
      matchedLabel: t("biometric.faceIdMatched"),
      setupLabel: t("biometric.setupFaceId"),
      protectedBy: t("biometric.yourFace"),
      vaultSummary: t("biometric.faceIdVaultSummary"),
      keyStoreName: t("biometric.secureEnclave"),
    };
  }

  return {
    kind,
    name: t("biometric.biometricUnlock"),
    matchedLabel: t("biometric.biometricMatched"),
    setupLabel: t("biometric.setupBiometric"),
    protectedBy: t("biometric.yourBiometrics"),
    vaultSummary: t("biometric.biometricVaultSummary"),
    keyStoreName: Platform.OS === "ios" ? t("biometric.secureEnclave") : t("biometric.androidKeystore"),
  };
}

function getKind(types: LocalAuthentication.AuthenticationType[]): BiometricKind {
  if (Platform.OS === "android") return "fingerprint";
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "face";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "fingerprint";
  return "generic";
}

export function useBiometricPresentation() {
  const { t, locale } = useLocalization();
  const [presentation, setPresentation] = useState(() =>
    getPresentation(Platform.OS === "android" ? "fingerprint" : "face", t),
  );

  useEffect(() => {
    let mounted = true;

    localAuth.checkBiometricAvailability()
      .then(({ types }) => {
        if (mounted) setPresentation(getPresentation(getKind(types), t));
      })
      .catch(() => {
        if (mounted) setPresentation(getPresentation(Platform.OS === "android" ? "fingerprint" : "generic", t));
      });

    return () => {
      mounted = false;
    };
  }, [locale, t]);

  return presentation;
}
