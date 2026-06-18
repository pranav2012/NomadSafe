import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";

export function Eyebrow({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  const { nomad } = useTheme();

  return (
    <Text
      style={{
        fontSize: nomad.typography.eyebrow.size,
        letterSpacing: nomad.typography.eyebrow.letterSpacing,
        fontWeight: nomad.typography.eyebrow.weight,
        color,
        textTransform: "uppercase",
        fontFamily: nomad.fonts.uiBold,
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
  const { nomad } = useTheme();
  const size = 40;

  return (
    <Text
      style={{
        fontFamily: nomad.fonts.display,
        fontWeight: nomad.typography.headline.weight,
        fontSize: size,
        lineHeight: size * 1.02,
        color,
        marginTop: 6,
        letterSpacing: 0,
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
  const { nomad } = useTheme();

  return (
    <Text
      style={{
        fontFamily: nomad.fonts.displayItalic,
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
  theme: themeProp,
}: {
  step: number;
  color: string;
  title: string;
  theme?: NomadTheme;
}) {
  const { nomad } = useTheme();
  const theme = themeProp ?? nomad.colors;

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
