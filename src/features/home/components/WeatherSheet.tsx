import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AuraChip } from "@/components/aura/AuraChip";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import { describeWeather } from "@/features/trips/services/weatherService";
import { buildOutlook, todayKey, toUnit, weekday, type DestinationForecast, type TemperatureUnit } from "@/features/trips/hooks/useTripForecast";
import { useLocalization } from "@/localization";

interface WeatherSheetProps {
  visible: boolean;
  onClose: () => void;
  destinations: DestinationForecast[];
  active: DestinationForecast;
  unit: TemperatureUnit;
  onSelect: (name: string) => void;
}

const RAIN = "#5B8CFF";
const WARM = "#FFB547";

/** Trip forecast in a sheet: destination switcher, today's detail, and a day list with low/high range bars. */
export function WeatherSheet({ visible, onClose, destinations, active, unit, onSelect }: WeatherSheetProps) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const lead = active.days[0];
  const condition = describeWeather(lead.weatherCode);
  const outlook = buildOutlook(active.days, locale, t);
  const today = todayKey();
  const meta = [
    t(`trip.weatherConditions.${condition.labelKey}`),
    lead.feelsLike != null ? t("trip.weatherFeelsLike", { temp: toUnit(lead.feelsLike, unit) }) : null,
    lead.uvIndex != null ? t("trip.weatherUv", { value: lead.uvIndex }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Shared scale so every day's bar is comparable across the whole forecast.
  const lows = active.days.map((d) => d.tempMin ?? d.tempMax);
  const scaleMin = Math.min(...lows);
  const span = Math.max(1, Math.max(...active.days.map((d) => d.tempMax)) - scaleMin);

  return (
    <AuraSheet visible={visible} onClose={onClose} title={t("trip.weatherTitle")} subtitle={active.name.split(",")[0]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {destinations.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.places}>
            {destinations.map((d) => (
              <AuraChip key={d.name} label={d.name.split(",")[0]} selected={d.name === active.name} onPress={() => onSelect(d.name)} />
            ))}
          </ScrollView>
        ) : null}

        <View style={[styles.hero, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <View style={[styles.highlight, { backgroundColor: c.highlight }]} />
          <View style={styles.heroRow}>
            <Text style={styles.emoji}>{condition.emoji}</Text>
            <View style={styles.heroText}>
              <Text style={[styles.temp, { color: c.text, fontFamily: f.semibold }]}>
                {`${toUnit(lead.tempMax, unit)}°`}
                <Text style={[styles.unit, { color: c.textMuted, fontFamily: f.medium }]}>{unit}</Text>
              </Text>
              <Text numberOfLines={2} style={[styles.meta, { color: c.textSoft, fontFamily: f.regular }]}>
                {meta}
              </Text>
            </View>
          </View>
          {outlook ? (
            <Text style={[styles.outlook, { color: c.textSoft, fontFamily: f.regular, borderTopColor: c.hairline }]}>
              <Text style={{ color: c.text, fontFamily: f.semibold }}>{outlook.title.charAt(0) + outlook.title.slice(1).toLocaleLowerCase(locale)}</Text> · {outlook.subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.days}>
          {active.days.map((day) => {
            const low = day.tempMin ?? day.tempMax;
            const rain = day.precipProbability != null && day.precipProbability >= 30 ? day.precipProbability : null;
            return (
              <View key={day.date} style={[styles.day, { borderBottomColor: c.hairline }]}>
                <Text numberOfLines={1} style={[styles.dayLabel, { color: day.date === today ? c.text : c.textSoft, fontFamily: f.medium }]}>
                  {day.date === today ? t("trip.weatherToday") : weekday(day.date, locale)}
                </Text>
                <View style={styles.dayIcon}>
                  <Text style={styles.dayEmoji}>{describeWeather(day.weatherCode).emoji}</Text>
                  {rain != null ? <Text style={[styles.rain, { fontFamily: f.semibold }]}>{rain}%</Text> : null}
                </View>
                <Text style={[styles.low, { color: c.textMuted, fontFamily: f.medium }]}>{`${toUnit(low, unit)}°`}</Text>
                <View style={[styles.track, { backgroundColor: c.surfaceStrong }]}>
                  <LinearGradient
                    colors={[RAIN, WARM]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.fill,
                      {
                        left: `${((low - scaleMin) / span) * 100}%`,
                        right: `${(1 - (day.tempMax - scaleMin) / span) * 100}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.high, { color: c.text, fontFamily: f.semibold }]}>{`${toUnit(day.tempMax, unit)}°`}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8, gap: 14 },
  bleed: { marginHorizontal: -20 },
  places: { paddingHorizontal: 20, gap: 8 },
  hero: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12, overflow: "hidden" },
  highlight: { position: "absolute", top: 0, left: 28, right: 28, height: StyleSheet.hairlineWidth },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  emoji: { fontSize: 46 },
  heroText: { flex: 1 },
  temp: { fontSize: 40, letterSpacing: -1.2 },
  unit: { fontSize: 17 },
  meta: { fontSize: 13.5, lineHeight: 18 },
  outlook: { fontSize: 13.5, lineHeight: 19, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  days: { marginTop: 2 },
  day: { flexDirection: "row", alignItems: "center", gap: 10, height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  dayLabel: { width: 54, fontSize: 14.5 },
  dayIcon: { width: 40, alignItems: "center" },
  dayEmoji: { fontSize: 20 },
  rain: { fontSize: 10.5, color: RAIN, marginTop: -2 },
  low: { width: 34, fontSize: 14.5, textAlign: "right", fontVariant: ["tabular-nums"] },
  track: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  fill: { position: "absolute", top: 0, bottom: 0, borderRadius: 3 },
  high: { width: 34, fontSize: 14.5, fontVariant: ["tabular-nums"] },
});
