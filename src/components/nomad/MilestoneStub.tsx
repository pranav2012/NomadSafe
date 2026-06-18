import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { Icon, type IconName } from "./Icon";
import { Eyebrow, HugeHeadline, HeadlineItalic } from "./Typography";

interface Props {
  eyebrow: string;
  /** Plain word that gets the italic accent inside the headline. */
  title: string;
  titleAccent: string;
  icon: IconName;
  /** Path to the source design screen in the handoff, e.g. "screens/sos.jsx". */
  designRef: string;
  /** What to build when this screen is picked up in a later milestone. */
  features: string[];
}

/**
 * Placeholder for screens slated for a later milestone. Renders in the nomad
 * design language and surfaces the design reference + planned scope so the
 * screen can be built out without re-deriving requirements.
 */
export function MilestoneStub({
  eyebrow,
  title,
  titleAccent,
  icon,
  designRef,
  features,
}: Props) {
  const { isDark, nomad } = useTheme();
  const { t } = useLocalization();
  const theme = nomad.colors;

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.mark, { backgroundColor: theme.inkDeep, shadowColor: theme.shadow }]}>
            <Icon name={icon} size={28} color={theme.mustard} strokeWidth={2} />
          </View>

          <Eyebrow color={theme.stamp}>{eyebrow}</Eyebrow>
          <HugeHeadline color={theme.inkDeep}>
            {title} <HeadlineItalic color={theme.stamp}>{titleAccent}</HeadlineItalic>.
          </HugeHeadline>

          <View style={[styles.badge, { backgroundColor: theme.mustardSoft }]}>
            <Icon name="clock" size={13} color={theme.mustard} strokeWidth={2} />
            <Text style={[styles.badgeText, { color: theme.mustard }]}>
              {t("common.laterMilestone")}
            </Text>
          </View>

          <View style={styles.listLabelRow}>
            <Text style={[styles.listLabel, { color: theme.inkMuted }]}>
              {t("common.planned")}
            </Text>
            <View style={[styles.hairline, { backgroundColor: theme.hairline }]} />
          </View>

          <View style={{ gap: 8 }}>
            {features.map((f, i) => (
              <View
                key={i}
                style={[styles.row, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}
              >
                <View style={[styles.dot, { borderColor: theme.hairline }]} />
                <Text style={[styles.rowText, { color: theme.inkSoft }]}>{f}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.ref, { color: theme.inkMuted }]}>
            {t("common.designReference", { designRef })}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 26, paddingTop: 24, paddingBottom: 140 },
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
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginTop: 16,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  listLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 28,
    marginBottom: 12,
  },
  listLabel: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  hairline: { flex: 1, height: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
  rowText: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: NOMAD_FONTS.ui,
    lineHeight: 13.5 * 1.4,
  },
  ref: {
    marginTop: 26,
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.3,
  },
});
