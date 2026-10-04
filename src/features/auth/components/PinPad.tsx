import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, PressableScale, useAura } from "@/atoms";
import { useLocalization } from "@/localization";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
] as const;

interface PinPadProps {
  onDigit: (digit: string) => void;
  onDelete: () => void;
  disabled?: boolean;
  /** Bottom-left slot, e.g. a biometric button; blank when omitted. */
  leftAction?: React.ReactNode;
  keySize?: number;
}

/** 3x4 glass keypad. Digits fire a light haptic; the caller owns the entered value. */
export function PinPad({ onDigit, onDelete, disabled = false, leftAction, keySize = 76 }: PinPadProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const gap = Math.round(keySize * 0.3);
  const keyStyle = { width: keySize, height: keySize, borderRadius: keySize / 2 };

  const digit = (value: string) => (
    <PressableScale
      key={value}
      onPress={() => onDigit(value)}
      disabled={disabled}
      pressedScale={0.9}
      accessibilityRole="button"
      accessibilityLabel={value}
      accessibilityState={{ disabled }}
      style={[styles.key, keyStyle, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
    >
      <Text style={[styles.digit, { color: c.text, fontFamily: f.medium, fontSize: keySize * 0.37 }]}>{value}</Text>
    </PressableScale>
  );

  return (
    <View style={[styles.pad, { gap, opacity: disabled ? 0.4 : 1 }]}>
      {ROWS.map((row) => (
        <View key={row[0]} style={[styles.row, { gap: gap * 1.15 }]}>
          {row.map(digit)}
        </View>
      ))}
      <View style={[styles.row, { gap: gap * 1.15 }]}>
        <View style={[styles.slot, keyStyle]}>{leftAction ?? null}</View>
        {digit("0")}
        <PressableScale
          onPress={onDelete}
          disabled={disabled}
          haptic={false}
          pressedScale={0.88}
          accessibilityRole="button"
          accessibilityLabel={t("auth.deleteDigit")}
          accessibilityState={{ disabled }}
          style={[styles.slot, keyStyle]}
        >
          <Icon name="chevronLeft" size={24} color={c.textSoft} strokeWidth={2} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { alignItems: "center" },
  row: { flexDirection: "row" },
  key: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  slot: { alignItems: "center", justifyContent: "center" },
  digit: { fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
});
