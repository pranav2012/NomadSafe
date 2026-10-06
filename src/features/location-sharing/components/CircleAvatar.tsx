import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAura } from "@/atoms";

const TONES = ["#8B97FF", "#22C7B8", "#FFB547", "#FF7A6B", "#9B7BFF"];
const LIVE = "#3DDC97";

/** Stable tone for a name, so a person keeps the same colour on every screen. */
export function circleTone(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TONES[Math.abs(hash) % TONES.length];
}

/** Initial in a tinted circle; a green ring while they share with you (grey once it goes stale). */
export function CircleAvatar({
  name,
  size = 40,
  sharing = false,
  stale = false,
  muted = false,
}: {
  name: string;
  size?: number;
  sharing?: boolean;
  stale?: boolean;
  muted?: boolean;
}) {
  const { c, f } = useAura();
  const tone = muted ? c.textMuted : circleTone(name);
  const ring = sharing ? (stale ? c.textMuted : LIVE) : null;
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${tone}26`,
          borderColor: ring ?? `${tone}66`,
          borderWidth: ring ? 2 : 1,
        },
      ]}
    >
      <Text style={[{ color: tone, fontFamily: f.semibold, fontSize: size * 0.4 }]}>
        {(name.trim().charAt(0) || "?").toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
});
