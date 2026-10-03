import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from "react-native-reanimated";
import { AuraChip } from "@/components/aura/AuraChip";
import { useAura } from "@/components/aura/useAura";
import { describeWeather } from "@/features/trips/services/weatherService";
import { buildOutlook, todayKey, toUnit, weekday, type DestinationForecast, type TemperatureUnit } from "@/features/trips/hooks/useTripForecast";
import { useLocalization } from "@/localization";

interface WeatherPanelProps {
  destinations: DestinationForecast[];
  active: DestinationForecast;
  unit: TemperatureUnit;
  onSelect: (name: string) => void;
}

/** Expanded forecast under the pass: destination switcher, today's detail and a 6-day strip. */
export function WeatherPanel({ destinations, active, unit, onSelect }: WeatherPanelProps) {
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

  return (
    <Animated.View
      entering={FadeInDown.duration(260)}
      exiting={FadeOutUp.duration(160)}
      layout={LinearTransition.duration(220)}
      style={[styles.panel, { backgroundColor: c.surface, borderColor: c.hairline }]}
    >
      <View style={[styles.highlight, { backgroundColor: c.highlight }]} />
      {destinations.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.places}>
          {destinations.map((d) => (
            <AuraChip key={d.name} label={d.name.split(",")[0]} selected={d.name === active.name} onPress={() => onSelect(d.name)} />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.hero}>
        <Text style={styles.emoji}>{condition.emoji}</Text>
        <View style={styles.heroText}>
          <Text style={[styles.temp, { color: c.text, fontFamily: f.semibold }]}>
            {`${toUnit(lead.tempMax, unit)}°`}
            <Text style={[styles.unit, { color: c.textMuted, fontFamily: f.medium }]}>{unit}</Text>
          </Text>
          <Text numberOfLines={1} style={[styles.meta, { color: c.textSoft, fontFamily: f.regular }]}>
            {meta}
          </Text>
        </View>
      </View>
      {outlook ? (
        <Text style={[styles.outlook, { color: c.textSoft, fontFamily: f.regular }]}>
          <Text style={{ color: c.text, fontFamily: f.semibold }}>{outlook.title.charAt(0) + outlook.title.slice(1).toLocaleLowerCase(locale)}</Text> · {outlook.subtitle}
        </Text>
      ) : null}

      <View style={[styles.strip, { borderTopColor: c.hairline }]}>
        {active.days.slice(0, 6).map((day) => (
          <View key={day.date} style={styles.day}>
            <Text numberOfLines={1} style={[styles.dayLabel, { color: day.date === today ? c.text : c.textMuted, fontFamily: f.medium }]}>
              {day.date === today ? t("trip.weatherToday") : weekday(day.date, locale)}
            </Text>
            <Text style={styles.dayEmoji}>{describeWeather(day.weatherCode).emoji}</Text>
            <Text style={[styles.dayTemp, { color: c.text, fontFamily: f.semibold }]}>{`${toUnit(day.tempMax, unit)}°`}</Text>
            {day.precipProbability != null && day.precipProbability >= 30 ? (
              <Text style={[styles.rain, { fontFamily: f.medium }]}>{day.precipProbability}%</Text>
            ) : null}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 14, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12, overflow: "hidden" },
  highlight: { position: "absolute", top: 0, left: 28, right: 28, height: StyleSheet.hairlineWidth },
  places: { gap: 8 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12 },
  emoji: { fontSize: 38 },
  heroText: { flex: 1 },
  temp: { fontSize: 34, letterSpacing: -1 },
  unit: { fontSize: 16 },
  meta: { fontSize: 13 },
  outlook: { fontSize: 13.5, lineHeight: 19 },
  strip: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  day: { flex: 1, alignItems: "center", gap: 4 },
  dayLabel: { fontSize: 12 },
  dayEmoji: { fontSize: 20 },
  dayTemp: { fontSize: 14 },
  rain: { fontSize: 11, color: "#5B8CFF" },
});
