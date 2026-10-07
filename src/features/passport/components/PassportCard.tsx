import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon, PressableScale, useAura } from "@/atoms";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { useLocalization } from "@/localization";
import { usePassport } from "../hooks/usePassport";
import { PassportStamp } from "./PassportStamp";

/** "Your passport" on the Trips screen: the latest stamp and the running totals. */
export function PassportCard({ onPress }: { onPress: () => void }) {
  const { c, f, isDark } = useAura();
  const { t, locale } = useLocalization();
  const passport = usePassport();
  const latest = passport.latest;
  const summary =
    passport.countries === 0 && passport.seals.length === 0
      ? t("passport.cardEmpty")
      : [t("passport.countries", { count: passport.countries }), passport.seals.length > 0 ? t("passport.states", { count: passport.seals.length }) : null]
          .filter(Boolean)
          .join(", ");
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={t("passport.cardTitle")} style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}>
      <LinearGradient
        colors={isDark ? ["rgba(91,108,255,0.30)", "rgba(155,123,255,0.14)", "rgba(34,199,184,0.10)"] : ["rgba(91,108,255,0.16)", "rgba(155,123,255,0.08)", "rgba(34,199,184,0.06)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.stamp}>
        {latest ? (
          <PassportStamp
            seed={latest.country}
            tiltSeed={latest.id}
            title={countryDisplayName(latest.country, locale)}
            top={null}
            bottom={latest.date.slice(0, 4)}
            viaApp={latest.viaApp}
            pending={false}
            width={88}
          />
        ) : (
          <Icon name="bookmark" size={26} color={c.textSoft} />
        )}
      </View>
      <View style={styles.flex}>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("passport.cardTitle")}</Text>
        <Text numberOfLines={2} style={[styles.summary, { color: c.textSoft, fontFamily: f.regular }]}>
          {summary}
        </Text>
      </View>
      <Icon name="chevronRight" size={16} color={c.textMuted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginTop: 16, overflow: "hidden" },
  stamp: { width: 92, height: 76, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  title: { fontSize: 18, letterSpacing: -0.3 },
  summary: { fontSize: 14, marginTop: 3, lineHeight: 19 },
});
