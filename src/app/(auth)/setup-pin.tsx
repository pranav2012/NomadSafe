import React, { useState, useCallback } from "react";
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
import { hashPin } from "@/utils/crypto";
import { secureStorage } from "@/services/secureStorage";
import { localAuth } from "@/services/localAuth";
import { lightImpact, errorNotification } from "@/utils/haptics";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";

const PIN_LENGTH = 6;
const NUMPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"];

export default function SetupPinScreen() {
  const router = useRouter();
  const { colors, typography, spacing, radii } = useTheme();
  const { setPinSet, setBiometricEnabled, setUnlocked } = useAuthStore();

  const [step, setStep] = useState<"create" | "confirm">("create");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const shakeX = useSharedValue(0);

  const currentPin = step === "create" ? pin : confirmPin;
  const setCurrentPin = step === "create" ? setPin : setConfirmPin;

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

  const handleKeyPress = (key: string) => {
    if (key === "delete") {
      setCurrentPin((prev) => prev.slice(0, -1));
      setError("");
      return;
    }
    if (key === "") return;

    lightImpact();
    if (currentPin.length >= PIN_LENGTH) return;

    const newPin = currentPin + key;
    setCurrentPin(newPin);

    if (newPin.length === PIN_LENGTH) {
      if (step === "create") {
        setTimeout(() => setStep("confirm"), 300);
      } else {
        if (newPin === pin) {
          handleComplete(newPin);
        } else {
          errorNotification();
          shake();
          setError("PINs don't match. Try again.");
          setTimeout(() => {
            setConfirmPin("");
            setError("");
          }, 1000);
        }
      }
    }
  };

  const handleComplete = async (finalPin: string) => {
    const hashed = await hashPin(finalPin);
    await secureStorage.setPin(hashed);
    setPinSet(true);

    const { available } = await localAuth.checkBiometricAvailability();
    if (available) {
      setBiometricEnabled(true);
    }

    setUnlocked(true);
    router.replace("/(tabs)");
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.container}>
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
          {step === "create" ? "Create a 6-digit PIN" : "Confirm your PIN"}
        </Text>
        <Text
          style={[
            styles.subtitle,
            {
              color: colors.textSecondary,
              fontSize: typography.sizes.base,
              marginTop: spacing.sm,
            },
          ]}
        >
          {step === "create"
            ? "This PIN will be used to unlock your app"
            : "Re-enter your PIN to confirm"}
        </Text>

        <Animated.View style={[styles.dotsRow, shakeStyle]}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i < currentPin.length ? colors.primary : colors.border,
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
              disabled={key === ""}
              style={[
                styles.numpadKey,
                {
                  backgroundColor:
                    key === "" ? "transparent" : colors.surface,
                  borderRadius: radii.full,
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

        {step === "confirm" && (
          <Button
            title="Start Over"
            onPress={() => {
              setStep("create");
              setPin("");
              setConfirmPin("");
              setError("");
            }}
            variant="ghost"
            fullWidth
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { textAlign: "center" },
  subtitle: { textAlign: "center" },
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
