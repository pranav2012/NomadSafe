import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAura } from "@/atoms";
import { auraStatusColors } from "@/constants/aura";

const SIZE = 64;
const [CALM_A, CALM_B, CALM_C] = auraStatusColors.calm;

/** Avatar (photo, or initial on the calm aura gradient) with name, email and a stats line. */
export function SettingsProfileHeader({ name, email, avatarUrl, stats }: { name: string; email?: string; avatarUrl?: string; stats: string }) {
  const { c, f } = useAura();
  const [imageFailed, setImageFailed] = useState(false);
  const initial = name.trim()[0]?.toUpperCase() ?? "N";
  const showImage = !!avatarUrl && !imageFailed;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <View style={[styles.highlight, { backgroundColor: c.highlight }]} />
      <View style={styles.avatarWrap}>
        <LinearGradient colors={[CALM_A, CALM_C, CALM_B]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ring}>
          {showImage ? (
            <Image
              source={{ uri: avatarUrl }}
              onError={() => setImageFailed(true)}
              style={[styles.photo, { borderColor: c.card }]}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text style={[styles.initial, { fontFamily: f.semibold }]}>{initial}</Text>
          )}
        </LinearGradient>
      </View>
      <View style={styles.text}>
        <Text style={[styles.name, { color: c.text, fontFamily: f.semibold }]} numberOfLines={1}>
          {name}
        </Text>
        {email ? (
          <Text style={[styles.email, { color: c.textSoft, fontFamily: f.regular }]} numberOfLines={1}>
            {email}
          </Text>
        ) : null}
        <Text style={[styles.stats, { color: c.textMuted, fontFamily: f.medium }]} numberOfLines={1}>
          {stats}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 22,
    padding: 16,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  highlight: { position: "absolute", top: 0, left: 28, right: 28, height: StyleSheet.hairlineWidth },
  avatarWrap: {
    shadowColor: CALM_A,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderRadius: SIZE / 2,
  },
  ring: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photo: { width: SIZE - 4, height: SIZE - 4, borderRadius: (SIZE - 4) / 2, borderWidth: 2 },
  initial: { color: "#FFFFFF", fontSize: 26, letterSpacing: -0.5 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 20, letterSpacing: -0.4 },
  email: { fontSize: 13.5 },
  stats: { fontSize: 12.5, marginTop: 4 },
});
