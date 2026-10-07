import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { localAuth } from "../services/localAuth";
import { useLocalization } from "@/localization";

type BiometricKind = "face" | "fingerprint" | "generic";

export interface BiometricPresentation {
  kind: BiometricKind;
  name: string;
}

function getPresentation(kind: BiometricKind, t: ReturnType<typeof useLocalization>["t"]): BiometricPresentation {
  if (kind === "fingerprint") {
    return { kind, name: Platform.OS === "ios" ? t("biometric.touchId") : t("biometric.fingerprint") };
  }
  if (kind === "face") return { kind, name: t("biometric.faceId") };
  return { kind, name: t("biometric.biometricUnlock") };
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

    localAuth
      .biometricTypes()
      .then((types) => {
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
