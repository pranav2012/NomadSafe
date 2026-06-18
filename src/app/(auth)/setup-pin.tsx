import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { NOMAD_FONTS, getNomadTheme } from "@/constants/nomadTokens";
import { useThemeContext } from "@/providers/ThemeProvider";
import { useAuthStore } from "@/stores/authStore";
import { hashPin } from "@/utils/crypto";
import { secureStorage } from "@/services/secureStorage";
import { localAuth } from "@/services/localAuth";
import { lightImpact, errorNotification } from "@/utils/haptics";
import { Icon } from "@/components/nomad/Icon";

const PIN_LENGTH = 6;
const NUMPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"];

export default function SetupPinScreen() {
  const router = useRouter();
  const { isDark } = useThemeContext();
  const theme = getNomadTheme(isDark);
  const { setPinSet, setBiometricEnabled, setUnlocked } = useAuthStore();

  const [step, setStep] = useState<"create" | "confirm">("create");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const shakeX = useSharedValue(0);

  const currentPin = step === "create" ? pin : confirmPin;
  const setCurrentPin = step === "create" ? setPin : setConfirmPin;

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const shake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [shakeX]);

  const handleComplete = async (finalPin: string) => {
    const hashed = await hashPin(finalPin);
    await secureStorage.setPin(hashed);
    setPinSet(true);

    const { available } = await localAuth.checkBiometricAvailability();
    if (available) setBiometricEnabled(true);

    setUnlocked(true);
    router.replace("/(tabs)");
  };

  const handleKeyPress = (key: string) => {
    if (key === "delete") {
      setCurrentPin((p) => p.slice(0, -1));
      setError("");
      return;
    }
    if (key === "") return;

    lightImpact();
    if (currentPin.length >= PIN_LENGTH) return;

    const next = currentPin + key;
    setCurrentPin(next);

    if (next.length === PIN_LENGTH) {
      if (step === "create") {
        setTimeout(() => setStep("confirm"), 280);
      } else if (next === pin) {
        handleComplete(next);
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
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.body}>
          {/* Lock mark */}
          <View style={[styles.mark, { backgroundColor: theme.inkDeep, shadowColor: "#1A1612" }]}>
            <Icon name="lock" size={26} color={theme.mustard} strokeWidth={2} />
          </View>

          <Text style={[styles.eyebrow, { color: theme.sky }]}>
            {step === "create" ? "Secure your vault" : "Confirm"}
          </Text>
          <Text style={[styles.headline, { color: theme.inkDeep }]}>
            {step === "create" ? (
              <>
                Create a{" "}
                <Text style={[styles.italic, { color: theme.sky }]}>6-digit</Text> PIN.
              </>
            ) : (
              <>
                Re-enter your{" "}
                <Text style={[styles.italic, { color: theme.sky }]}>PIN</Text>.
              </>
            )}
          </Text>
          <Text style={[styles.sub, { color: theme.inkSoft }]}>
            {step === "create"
              ? "Unlocks the app when Face ID isn't available."
              : "Enter the same PIN once more to confirm."}
          </Text>

          {/* Dots */}
          <Animated.View style={[styles.dotsRow, shakeStyle]}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i < currentPin.length ? theme.inkDeep : "transparent",
                    borderColor: i < currentPin.length ? theme.inkDeep : theme.hairline,
                  },
                ]}
              />
            ))}
          </Animated.View>

          {error ? (
            <Text style={[styles.error, { color: theme.stamp }]}>{error}</Text>
          ) : (
            <View style={{ height: 18 }} />
          )}

          <View style={styles.numpad}>
            {NUMPAD.map((key, i) => (
              <Pressable
                key={i}
                onPress={() => handleKeyPress(key)}
                disabled={key === ""}
                style={[
                  styles.numKey,
                  {
                    backgroundColor: key === "" ? "transparent" : theme.paperSoft,
                    borderColor: key === "" ? "transparent" : theme.hairline,
                  },
                ]}
              >
                {key === "delete" ? (
                  <Icon name="chevronLeft" size={22} color={theme.inkDeep} />
                ) : (
                  <Text style={[styles.numKeyText, { color: theme.inkDeep }]}>{key}</Text>
                )}
              </Pressable>
            ))}
          </View>

          {step === "confirm" && (
            <Pressable
              onPress={() => {
                setStep("create");
                setPin("");
                setConfirmPin("");
                setError("");
              }}
              style={styles.startOver}
            >
              <Text style={[styles.startOverText, { color: theme.inkSoft }]}>Start over</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 26 },
  mark: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 1.8,
    fontWeight: "700",
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
    textAlign: "center",
  },
  headline: {
    fontFamily: NOMAD_FONTS.display,
    fontWeight: "500",
    fontSize: 34,
    lineHeight: 34 * 1.04,
    marginTop: 6,
    letterSpacing: -0.6,
    textAlign: "center",
  },
  italic: { fontFamily: NOMAD_FONTS.displayItalic, fontStyle: "italic" },
  sub: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.5,
    fontFamily: NOMAD_FONTS.ui,
    textAlign: "center",
  },
  dotsRow: { flexDirection: "row", gap: 16, marginTop: 36 },
  dot: { width: 14, height: 14, borderRadius: 999, borderWidth: 1.5 },
  error: {
    fontSize: 13,
    textAlign: "center",
    fontFamily: NOMAD_FONTS.uiMedium,
    marginTop: 14,
    height: 18,
  },
  numpad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    width: 280,
    marginTop: 24,
    gap: 16,
  },
  numKey: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  numKeyText: { fontSize: 26, fontFamily: NOMAD_FONTS.display, fontWeight: "500" },
  startOver: { marginTop: 28 },
  startOverText: { fontSize: 13, fontFamily: NOMAD_FONTS.uiSemi, fontWeight: "600" },
});
