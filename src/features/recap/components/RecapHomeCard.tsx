import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { AuraButton, Icon, PressableScale, useAura } from "@/atoms";
import { auraStatusColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { useTripRecap } from "../hooks/useTripRecap";

/** Shown on Home once the active trip has ended: watch the replay, extend the trip, or put it away. */
export function RecapHomeCard({ tripId, onWatch, onExtend, onDismiss }: { tripId: string; onWatch: () => void; onExtend: () => void; onDismiss: () => void }) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const recap = useTripRecap(tripId);
  if (!recap) return null;
  const tint = auraStatusColors.calm;
  const highlights = recap.stats.slice(0, 3);

  return (
    <Animated.View entering={FadeInDown.duration(380)} style={[styles.card, { backgroundColor: c.card, borderColor: c.highlight }]}>
      <LinearGradient
        colors={[`${tint[0]}${isDark ? "48" : "30"}`, `${tint[1]}${isDark ? "2A" : "1C"}`, `${tint[2]}${isDark ? "1C" : "12"}`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={[styles.kicker, { color: c.textSoft, fontFamily: f.semibold }]}>{t("recap.homeKicker")}</Text>
          <Text numberOfLines={2} style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
            {t("recap.homeTitle", { name: recap.trip.name })}
          </Text>
        </View>
        <PressableScale onPress={onDismiss} accessibilityRole="button" accessibilityLabel={t("recap.homeDismiss")} style={[styles.round, { backgroundColor: c.surfaceStrong }]}>
          <Icon name="x" size={14} color={c.textSoft} />
        </PressableScale>
      </View>
      <View style={styles.stats}>
        {highlights.map((stat) => (
          <View key={stat.key} style={styles.stat}>
            <Text numberOfLines={1} style={[styles.statValue, { color: c.text, fontFamily: f.semibold }]}>
              {stat.value}
            </Text>
            <Text numberOfLines={1} style={[styles.statLabel, { color: c.textSoft, fontFamily: f.regular }]}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>
      <AuraButton label={t("recap.watchReplay")} icon="play" onPress={onWatch} />
      <AuraButton label={t("recap.extendTrip")} variant="ghost" size="md" onPress={onExtend} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 12, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, padding: 18, gap: 14, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  flex: { flex: 1 },
  kicker: { fontSize: 12.5, letterSpacing: 1.1, textTransform: "uppercase" },
  title: { fontSize: 24, letterSpacing: -0.6, marginTop: 4 },
  round: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stats: { flexDirection: "row", gap: 12 },
  stat: { flex: 1 },
  statValue: { fontSize: 22, letterSpacing: -0.6 },
  statLabel: { fontSize: 12.5, marginTop: 2 },
});
