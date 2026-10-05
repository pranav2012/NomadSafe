import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraSheet, PressableScale, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { errorNotification } from "@/utils/haptics";
import { useBiometricPresentation } from "../hooks/useBiometricPresentation";
import { localAuth } from "../services/localAuth";
import { checkPin } from "../services/pinVerifier";
import { useAuthStore } from "../store/authStore";
import { BiometricGlyph } from "./BiometricGlyph";
import { PinDots } from "./PinDots";
import { PinPad } from "./PinPad";

const PIN_LENGTH = 6;
const DANGER = "#FF4D5E";

interface PinConfirmSheetProps {
  visible: boolean;
  subtitle: string;
  /** Offer biometric unlock (when it's turned on) instead of the PIN. */
  allowBiometric: boolean;
  onDone: (confirmed: boolean) => void;
}

/** Asks for the current PIN before a security setting changes, under the lock screen's attempt limits. */
export function PinConfirmSheet({ visible, subtitle, allowBiometric, onDone }: PinConfirmSheetProps) {
  const { c, f } = useAura();
  const { t, formatDuration } = useLocalization();
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const biometric = useBiometricPresentation();
  const [pin, setPinState] = useState("");
  const pinRef = useRef("");
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const showBiometric = allowBiometric && biometricEnabled;

  const setPin = (value: string) => {
    pinRef.current = value;
    setPinState(value);
  };

  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = setTimeout(() => {
      setLockedUntil(null);
      setError("");
    }, Math.max(0, lockedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  const lockOut = (remainingMs: number) => {
    setLockedUntil(Date.now() + remainingMs);
    setError(t("auth.lockedFor", { duration: formatDuration(Math.ceil(remainingMs / 1000)) }));
  };

  const submit = async (value: string) => {
    setBusy(true);
    try {
      const result = await checkPin(value);
      if (result.status === "ok") {
        onDone(true);
        return;
      }
      if (result.status === "missing") {
        setError(t("auth.pinUnavailable"));
      } else if (result.status === "locked") {
        lockOut(result.remainingMs);
      } else {
        errorNotification();
        setShakeKey((k) => k + 1);
        if (result.lockMs > 0) lockOut(result.lockMs);
        else setError(t("auth.attemptsRemaining", { count: result.attemptsLeft }));
      }
      setTimeout(() => setPin(""), 300);
    } catch {
      setError(t("auth.pinUnavailable"));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const handleDigit = (key: string) => {
    if (busy || lockedUntil !== null || pinRef.current.length >= PIN_LENGTH) return;
    const next = pinRef.current + key;
    setPin(next);
    setError("");
    if (next.length === PIN_LENGTH) void submit(next);
  };

  const handleDelete = () => {
    if (busy) return;
    setPin(pinRef.current.slice(0, -1));
  };

  const scanBiometric = async () => {
    try {
      const ok = await localAuth.authenticateWithBiometric({
        promptMessage: subtitle,
        cancelLabel: t("auth.nativeCancelLabel"),
      });
      if (ok) onDone(true);
    } catch {
      setError(t("auth.biometricError"));
    }
  };

  return (
    <AuraSheet visible={visible} onClose={() => onDone(false)} title={t("auth.enterPinTitle")} subtitle={subtitle}>
      <View style={styles.body}>
        <PinDots length={PIN_LENGTH} filled={pin.length} shakeKey={shakeKey} error={!!error && pin.length === PIN_LENGTH} />
        <Text
          accessibilityRole={error ? "alert" : undefined}
          accessibilityLiveRegion="polite"
          style={[styles.error, { color: DANGER, fontFamily: f.medium }]}
        >
          {error}
        </Text>
        <PinPad
          onDigit={handleDigit}
          onDelete={handleDelete}
          disabled={busy || lockedUntil !== null}
          keySize={64}
          leftAction={
            showBiometric ? (
              <PressableScale
                onPress={() => void scanBiometric()}
                accessibilityRole="button"
                accessibilityLabel={t("auth.useBiometric", { biometricName: biometric.name })}
                style={styles.leftAction}
              >
                <BiometricGlyph kind={biometric.kind} size={28} color={c.textSoft} />
              </PressableScale>
            ) : undefined
          }
        />
      </View>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: "center", paddingTop: 8, paddingBottom: 16 },
  error: { fontSize: 13, textAlign: "center", minHeight: 18, marginTop: 14, marginBottom: 16, paddingHorizontal: 24 },
  leftAction: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
});
