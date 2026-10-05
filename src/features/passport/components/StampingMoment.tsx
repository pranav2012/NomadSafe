import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { AuraButton } from "@/atoms";
import { auraDark, auraFonts as f } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { heavyImpact } from "@/utils/haptics";
import { PassportStamp, StateSeal } from "./PassportStamp";

const c = auraDark;
const STAGGER_MS = 520;

export interface MomentItem {
  key: string;
  kind: "stamp" | "seal";
  seed: string;
  title: string;
  top: string | null;
  bottom: string;
}

/** Comes down hard, overshoots a little and settles: a rubber stamp hitting the page. */
function Slam({ index, children }: { index: number; children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    progress.set(
      withDelay(
        300 + index * STAGGER_MS,
        withSpring(1, { damping: 11, stiffness: 260, mass: 0.7 }, (finished) => {
          if (finished) scheduleOnRN(heavyImpact);
        }),
      ),
    );
  }, [index, progress, reduceMotion]);
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return { opacity: Math.min(1, p * 1.6), transform: [{ scale: 2.1 - 1.1 * p }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** The replay's stamping beat: the trip's new stamps (or state seals) pressed into a passport page. */
export function StampingMoment({ items, width, onOpenPassport }: { items: MomentItem[]; width: number; onOpenPassport: () => void }) {
  const { t } = useLocalization();
  const shown = items.slice(0, 4);
  const stampWidth = shown.length === 1 ? width * 0.62 : (width - 60) / 2;
  const fade = useSharedValue(0);
  useEffect(() => {
    fade.set(withTiming(1, { duration: 400 }));
  }, [fade]);
  const pageStyle = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateY: (1 - fade.get()) * 30 }] }));

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>{t("recap.stampedKicker")}</Text>
      <Text style={styles.title}>{t("recap.stampedTitle")}</Text>
      <Animated.View style={[styles.page, { width }, pageStyle]}>
        <LinearGradient colors={["#1A1E29", c.card, "#0F1219"]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.grid}>
          {shown.map((item, i) => (
            <Slam key={item.key} index={i}>
              {item.kind === "stamp" ? (
                <PassportStamp seed={item.seed} tiltSeed={item.key} title={item.title} top={item.top} bottom={item.bottom} viaApp pending={false} width={stampWidth} />
              ) : (
                <StateSeal title={item.title} bottom={item.bottom} visits={1} viaApp width={stampWidth * 0.8} />
              )}
            </Slam>
          ))}
        </View>
      </Animated.View>
      <AuraButton label={t("recap.openPassport")} variant="ghost" size="md" onPress={onOpenPassport} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 8 },
  kicker: { fontFamily: f.regular, fontSize: 16, color: c.textSoft },
  title: { fontFamily: f.semibold, fontSize: 34, letterSpacing: -1, color: c.text, textAlign: "center", marginBottom: 12 },
  page: { borderRadius: 26, overflow: "hidden", borderWidth: 1, borderColor: c.highlight, paddingVertical: 26, paddingHorizontal: 14, minHeight: 260, justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 12 },
});
