import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";

export function Eyebrow({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Text
      style={{
        fontSize: 10.5,
        letterSpacing: 1.8,
        fontWeight: "700",
        color,
        textTransform: "uppercase",
        fontFamily: NOMAD_FONTS.uiBold,
      }}
    >
      {children}
    </Text>
  );
}

export function HugeHeadline({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  return (
    <Text
      style={{
        fontFamily: NOMAD_FONTS.display,
        fontWeight: "500",
        fontSize: 40,
        lineHeight: 40 * 1.02,
        color,
        marginTop: 6,
        letterSpacing: -0.7,
      }}
    >
      {children}
    </Text>
  );
}

export function HeadlineItalic({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <Text
      style={{
        fontFamily: NOMAD_FONTS.displayItalic,
        fontStyle: "italic",
        color,
      }}
    >
      {children}
    </Text>
  );
}

export function SectionLabel({
  step,
  color,
  title,
  theme,
}: {
  step: number;
  color: string;
  title: string;
  theme: NomadTheme;
}) {
  return (
    <View style={styles.sectionRow}>
      <Text
        style={[styles.sectionStep, { color, fontFamily: NOMAD_FONTS.monoMedium }]}
      >
        0{step}
      </Text>
      <Text style={[styles.sectionTitle, { color: theme.inkDeep }]}>
        {title}
      </Text>
      <View style={[styles.sectionHairline, { backgroundColor: theme.hairline }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  sectionStep: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  sectionHairline: {
    flex: 1,
    height: 1,
  },
});
