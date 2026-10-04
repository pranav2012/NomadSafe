import React, { useEffect } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from "react-native-reanimated";
import { springs } from "./springs";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface RollingNumberProps {
  value: string;
  lineHeight: number;
  style?: StyleProp<TextStyle>;
}

/** Odometer-style text: each digit column springs to its new value, staggered from the right. */
export function RollingNumber({ value, lineHeight, style: textStyle }: RollingNumberProps) {
  // Margins belong on the row: on each stacked digit they'd push every digit off its slot.
  const { margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, ...style } =
    StyleSheet.flatten(textStyle) ?? {};
  const rowMargins = { margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical };
  const chars = value.split("");
  return (
    <View style={[styles.row, rowMargins]} accessible accessibilityLabel={value}>
      {chars.map((char, index) => {
        // Key from the right so existing columns keep their identity when the length changes.
        const key = chars.length - index;
        return DIGITS.includes(char) ? (
          <DigitColumn key={key} digit={Number(char)} delay={(chars.length - index) * 40} lineHeight={lineHeight} style={style} />
        ) : (
          <Text key={key} style={[style, { lineHeight, height: lineHeight }]}>
            {char}
          </Text>
        );
      })}
    </View>
  );
}

function DigitColumn({
  digit,
  delay,
  lineHeight,
  style,
}: {
  digit: number;
  delay: number;
  lineHeight: number;
  style?: StyleProp<TextStyle>;
}) {
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.set(withDelay(delay, withSpring(-digit * lineHeight, springs.snappy)));
  }, [delay, digit, lineHeight, offset]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  return (
    <View style={{ height: lineHeight, overflow: "hidden" }}>
      <Animated.View style={animatedStyle}>
        {DIGITS.map((d) => (
          <Text key={d} style={[style, styles.digit, { lineHeight, height: lineHeight }]}>
            {d}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  digit: { fontVariant: ["tabular-nums"], textAlign: "center" },
});
