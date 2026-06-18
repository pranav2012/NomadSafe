import React, { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/stores/authStore";
import { verifyPin } from "@/utils/crypto";
import { secureStorage } from "@/services/secureStorage";
import { localAuth } from "@/services/localAuth";
import { lightImpact, errorNotification } from "@/utils/haptics";
import { Screen } from "@/components/layout/Screen";

const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 30000;
const NUMPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"];

export default function LockScreen() {
  const router = useRouter();
  const { colors, typography, spacing, radii } = useTheme();
  const { biometricEnabled, setUnlocked } = useAuthStore();

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const shakeX = useSharedValue(0);

  const isLocked = lockedUntil !== null && Date.now() < lockedUntil;

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const shake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [shakeX]);

  const handleUnlock = useCallback(() => {
    setUnlocked(true);
    router.replace("/(tabs)");
  }, [setUnlocked, router]);

  // Auto-trigger biometric on mount
  useEffect(() => {
    if (biometricEnabled) {
      localAuth.authenticateWithBiometric().then((success) => {
        if (success) handleUnlock();
      });
    }
  }, [biometricEnabled, handleUnlock]);

  const handleKeyPress = async (key: string) => {
    if (isLocked || key === "") return;

    if (key === "delete") {
      setPin((prev) => prev.slice(0, -1));
      setError("");
      return;
    }

    lightImpact();
    if (pin.length >= PIN_LENGTH) return;

    const newPin = pin + key;
    setPin(newPin);

    if (newPin.length === PIN_LENGTH) {
      const storedHash = await secureStorage.getPin();
      if (!storedHash) return;

      const isValid = await verifyPin(newPin, storedHash);
      if (isValid) {
        setAttempts(0);
        handleUnlock();
      } else {
        errorNotification();
        shake();
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (newAttempts >= MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_DURATION);
          setError("Too many attempts. Try again in 30 seconds.");
          setTimeout(() => {
            setLockedUntil(null);
            setAttempts(0);
            setError("");
          }, LOCKOUT_DURATION);
        } else {
          setError(
            `Incorrect PIN. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`,
          );
        }
        setTimeout(() => setPin(""), 300);
      }
    }
  };

  const handleBiometric = async () => {
    const success = await localAuth.authenticateWithBiometric();
    if (success) handleUnlock();
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.container}>
        <Ionicons
          name="lock-closed"
          size={48}
          color={colors.primary}
          style={{ marginBottom: spacing.lg }}
        />
        <Text
          style={[
            styles.title,
            {
              color: colors.text,
              fontSize: typography.sizes["2xl"],
              fontWeight: typography.weights.bold,
            },
          ]}
        >
          Unlock NomadSafe
        </Text>

        <Animated.View style={[styles.dotsRow, shakeStyle]}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i < pin.length ? colors.primary : colors.border,
                  borderRadius: radii.full,
                },
              ]}
            />
          ))}
        </Animated.View>

        {error ? (
          <Text
            style={{
              color: colors.error,
              fontSize: typography.sizes.sm,
              textAlign: "center",
              marginTop: spacing.md,
            }}
          >
            {error}
          </Text>
        ) : null}

        <View style={styles.numpad}>
          {NUMPAD.map((key, index) => (
            <Pressable
              key={index}
              onPress={() => handleKeyPress(key)}
              disabled={key === "" || isLocked}
              style={[
                styles.numpadKey,
                {
                  backgroundColor:
                    key === "" ? "transparent" : colors.surface,
                  borderRadius: radii.full,
                  opacity: isLocked ? 0.4 : 1,
                },
              ]}
            >
              {key === "delete" ? (
                <Ionicons
                  name="backspace-outline"
                  size={24}
                  color={colors.text}
                />
              ) : (
                <Text
                  style={{
                    color: colors.text,
                    fontSize: typography.sizes["2xl"],
                    fontWeight: typography.weights.semibold,
                  }}
                >
                  {key}
                </Text>
              )}
            </Pressable>
          ))}
        </View>

        {biometricEnabled && (
          <Pressable
            onPress={handleBiometric}
            style={{ marginTop: spacing["2xl"] }}
          >
            <Ionicons
              name="finger-print"
              size={40}
              color={colors.primary}
            />
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { textAlign: "center" },
  dotsRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 40,
    marginBottom: 16,
  },
  dot: { width: 16, height: 16 },
  numpad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    width: 280,
    marginTop: 40,
    gap: 16,
  },
  numpadKey: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
});
