import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated from "react-native-reanimated";
import { Icon, RollingNumber, type IconName } from "@/atoms";
import { auraFonts as f } from "@/constants/aura";
import { TRANSIT_MODES } from "@/features/itinerary/constants/eventTypes";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { useLocalization } from "@/localization";
import type { WalkingTotals } from "@/modules/health";
import type { TripRecap } from "../../hooks/useTripRecap";
import type { RecapDistanceMode } from "../../utils/recapFacts";
import { useGroupBalances } from "@/features/expenses/hooks/useGroupBalances";
import { compareDistance, type CountryMilestones, type DistanceComparison } from "../../utils/replayFacts";
import { AURORA } from "../recapGeometry";
import { ACCENT, c, rise, rs } from "./replayStyles";

const MODE_ICON = {
  ...Object.fromEntries(TRANSIT_MODES.map((mode) => [mode.id, mode.icon])),
  likelyFlight: "plane",
  other: "compass",
} as Record<RecapDistanceMode, IconName>;

/** A country's flag emoji from its ISO code ("JP" → 🇯🇵). */
const flag = (code: string) => String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** Where a stat chapter sits: under the small route map, centred in the space left. */
export interface StatFrame {
  top: number;
  bottom: number;
}

function listFormat(items: string[], locale: string) {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

function useComparisonText(comparison: DistanceComparison | null): string | null {
  const { t, locale } = useLocalization();
  if (!comparison) return null;
  switch (comparison.kind) {
    case "earthTimes":
      return t("recap.compare.earthTimes", { times: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(comparison.times) });
    case "earthFraction":
      return t(`recap.compare.earthFraction.${comparison.fraction}`);
    default:
      return t(`recap.compare.${comparison.kind}`, { count: comparison.count });
  }
}

/** Total distance, split by how you travelled, with a familiar comparison. */
export function DistanceChapter({ recap, frame }: { recap: TripRecap; frame: StatFrame }) {
  const { t, formatDistance } = useLocalization();
  const comparison = useComparisonText(compareDistance(recap.facts.totalKm));
  const modes = (Object.entries(recap.facts.kmByMode) as [RecapDistanceMode, number][]).filter(([, km]) => km >= 1).sort((a, b) => b[1] - a[1]);
  const modeLabel = (mode: RecapDistanceMode) =>
    mode === "other" ? t("recap.legendOther") : mode === "likelyFlight" ? t("recap.likelyFlights") : t(`itinerary.transitModes.${mode}`);
  return (
    <View style={[rs.block, styles.centred, frame]}>
      <Text style={rs.kicker}>{t("recap.distanceKicker")}</Text>
      <RollingNumber calm value={formatDistance(recap.facts.totalKm)} lineHeight={70} style={rs.big} />
      {comparison ? (
        <Animated.Text entering={rise(500)} style={[rs.sub, styles.lead]}>
          {comparison}
        </Animated.Text>
      ) : null}
      <View style={styles.modes}>
        {modes.map(([mode, km], i) => (
          <Animated.View key={mode} entering={rise(900 + i * 180)} style={styles.modeRow}>
            <View style={styles.modeIcon}>
              <Icon name={MODE_ICON[mode]} size={16} color={ACCENT} />
            </View>
            <Text style={[rs.sub, rs.flex]}>{modeLabel(mode)}</Text>
            <Text style={styles.modeKm}>{formatDistance(km)}</Text>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** First visits ("Country #14") and the passport's running total. */
export function CountriesChapter({ recap, milestones, frame }: { recap: TripRecap; milestones: CountryMilestones; frame: StatFrame }) {
  const { t, locale } = useLocalization();
  const first = milestones.firstTime.slice(0, 3);
  return (
    <View style={[rs.block, styles.centred, frame]}>
      <Text style={rs.kicker}>{t("recap.countriesKicker")}</Text>
      <View style={styles.flags} accessible={false}>
        {recap.facts.countries.slice(0, 8).map((code, i) => (
          <Animated.Text key={code} entering={rise(100 + i * 120)} style={styles.flag}>
            {flag(code)}
          </Animated.Text>
        ))}
      </View>
      {first.length > 0 ? (
        first.map((country, i) => (
          <Animated.View key={country} entering={rise(200 + i * 450)} style={styles.firstRow}>
            <Text numberOfLines={2} style={[rs.headline, styles.firstTitle]}>
              {t("recap.firstTime", { place: countryDisplayName(country, locale) })}
            </Text>
            <Animated.View entering={rise(450 + i * 450)} style={styles.badge}>
              <LinearGradient colors={AURORA as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <Text style={styles.badgeText}>{t("recap.countryNumber", { n: milestones.numbers[country] })}</Text>
            </Animated.View>
          </Animated.View>
        ))
      ) : (
        <>
          <RollingNumber calm value={String(recap.facts.countries.length)} lineHeight={70} style={rs.big} />
          <Text style={rs.sub}>{t("recap.countriesOnTrip", { count: recap.facts.countries.length })}</Text>
          <Text style={[rs.sub, rs.muted]}>{listFormat(recap.facts.countries.map((code) => countryDisplayName(code, locale)), locale)}</Text>
        </>
      )}
      {milestones.total > 0 ? (
        <Animated.View entering={rise(400 + first.length * 450)} style={[rs.chip, styles.total]}>
          <Icon name="globe" size={15} color={ACCENT} />
          <Text style={rs.chipText}>{t("recap.passportTotal", { count: milestones.total })}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/** Who came along: avatars, "with Asha, Ravi and 2 others", days together and, on trips with splits, how the money ended (counts only). */
export function CompanionsChapter({ recap, frame }: { recap: TripRecap; frame: StatFrame }) {
  const { t, locale } = useLocalization();
  const names = recap.companions;
  const { splitExpenses, transfers } = useGroupBalances(recap.trip);
  const shown = names.length <= 3 ? names : names.slice(0, 2);
  const others = names.length - shown.length;
  const people = listFormat(others > 0 ? [...shown, t("recap.andOthers", { count: others })] : shown, locale);
  const lines = [
    { icon: "calendar" as const, text: t("recap.daysTogether", { count: recap.facts.days }) },
    ...(splitExpenses.length > 0
      ? [
          { icon: "receipt" as const, text: t("recap.splitTogether", { count: splitExpenses.length }) },
          transfers.length === 0 ? { icon: "check" as const, text: t("recap.allSettled") } : { icon: "clock" as const, text: t("recap.openBalances", { count: transfers.length }) },
        ]
      : []),
  ];
  return (
    <View style={[rs.block, styles.centred, frame]}>
      <Text style={rs.kicker}>{t("recap.companionsKicker")}</Text>
      <View style={styles.avatars}>
        {names.slice(0, 6).map((name, i) => (
          <Animated.View key={name} entering={rise(150 + i * 140)} style={[styles.avatar, { marginLeft: i === 0 ? 0 : -14, zIndex: 10 - i }]}>
            <LinearGradient colors={[AURORA[i % 3], AURORA[(i + 1) % 3]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={styles.avatarText}>{initials(name)}</Text>
          </Animated.View>
        ))}
      </View>
      <Animated.Text entering={rise(400 + Math.min(6, names.length) * 140)} style={rs.headline}>
        {t("recap.withPeople", { names: people })}
      </Animated.Text>
      <View style={styles.modes}>
        {lines.map((line, i) => (
          <Animated.View key={line.text} entering={rise(900 + i * 180)} style={styles.modeRow}>
            <View style={styles.modeIcon}>
              <Icon name={line.icon} size={16} color={ACCENT} />
            </View>
            <Text style={[rs.sub, rs.flex, styles.lineText]}>{line.text}</Text>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** Days, distance, cities and steps, counting up. */
export function NumbersChapter({ recap, walking, frame }: { recap: TripRecap; walking: WalkingTotals | null; frame: StatFrame }) {
  const { t, formatDistance, formatCompactNumber } = useLocalization();
  const { places } = recap;
  const rows = [
    { value: String(recap.facts.days), label: t("recap.daysAway", { count: recap.facts.days }) },
    ...(recap.distance ? [{ value: recap.distance, label: [t("recap.travelled"), recap.modeSummary].filter(Boolean).join(", ") }] : []),
    {
      value: String(places.length),
      label:
        places.length > 1
          ? t("recap.citiesFromTo", { count: places.length, from: places[0], to: places[places.length - 1] })
          : t("recap.cities", { count: places.length }),
    },
    ...(walking && walking.steps > 0
      ? [
          {
            value: formatCompactNumber(Math.round(walking.steps)),
            label: t(walking.estimated ? "recap.stepsWalkedAbout" : "recap.stepsWalked", { count: Math.round(walking.steps), distance: formatDistance(walking.km) }),
          },
        ]
      : []),
  ];
  return (
    <View style={[rs.block, styles.centred, frame]}>
      <Text style={rs.kicker}>{t("recap.numbersKicker")}</Text>
      {rows.map((row, i) => (
        <Animated.View key={row.label} entering={rise(180 * i)} style={styles.numberRow}>
          <RollingNumber calm value={row.value} lineHeight={60} style={styles.number} />
          <Text style={[rs.sub, rs.muted]}>{row.label}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  centred: { justifyContent: "center" },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 6 },
  flag: { fontSize: 40, lineHeight: 48 },
  lineText: { color: c.text },
  lead: { color: c.text, fontSize: 19, lineHeight: 26 },
  modes: { marginTop: 18, gap: 12 },
  modeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  modeIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceStrong },
  modeKm: { fontFamily: f.semibold, fontSize: 17, color: c.text },
  firstRow: { gap: 10, marginBottom: 14 },
  firstTitle: { fontSize: 40, lineHeight: 45 },
  badge: { alignSelf: "flex-start", borderRadius: 14, overflow: "hidden", paddingHorizontal: 14, paddingVertical: 7 },
  badgeText: { fontFamily: f.bold, fontSize: 17, color: "#FFFFFF", letterSpacing: -0.2 },
  total: { marginTop: 10 },
  avatars: { flexDirection: "row", marginVertical: 16 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: c.bg,
  },
  avatarText: { fontFamily: f.semibold, fontSize: 22, color: "#FFFFFF" },
  numberRow: { marginTop: 4 },
  number: { fontFamily: f.semibold, fontSize: 58, letterSpacing: -2.4, color: c.text },
});
