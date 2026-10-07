import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Icon } from "@/atoms";
import { TRANSIT_MODES } from "@/features/itinerary/constants/eventTypes";
import { useLocalization } from "@/localization";
import { PrivateView } from "@/modules/analytics";
import { FlapBoard } from "../FlapBoard";
import { placeCode, shortPlace, type TripRecap } from "../../hooks/useTripRecap";
import type { TripPhoto } from "../../store/tripPhotosStore";
import type { DailySteps } from "../../utils/replayFacts";
import { ACCENT, c, rise, rs } from "./replayStyles";

export interface StopTiming {
  /** Fraction of the chapter where the photos start (1 without photos). */
  arrival: number;
  /** Fraction each photo plays for. */
  photo: number;
  /** Fraction a crossfade takes. */
  fade: number;
}

const clamp = (v: number) => {
  "worklet";
  return Math.min(1, Math.max(0, v));
};

/** One photo, full-bleed, slowly zooming and drifting (Ken Burns) while its window of the chapter plays. */
function KenBurnsPhoto({ photo, index, timing, progress, still }: { photo: TripPhoto; index: number; timing: StopTiming; progress: SharedValue<number>; still: boolean }) {
  const start = timing.arrival + index * timing.photo;
  const end = start + timing.photo;
  const direction = index % 2 === 0 ? 1 : -1;
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    const local = clamp((p - start + timing.fade) / (end - start + timing.fade));
    return {
      opacity: clamp((p - start + timing.fade) / timing.fade),
      transform: still ? [] : [{ scale: 1.06 + 0.1 * local }, { translateX: direction * (local - 0.5) * 26 }, { translateY: (local - 0.5) * -12 }],
    };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

/** The stop's photos behind the map: they take over once the arrival has played. */
export function StopPhotos({ photos, timing, progress, still }: { photos: TripPhoto[]; timing: StopTiming; progress: SharedValue<number>; still: boolean }) {
  return (
    <PrivateView style={StyleSheet.absoluteFill}>
      {photos.map((photo, i) => (
        <KenBurnsPhoto key={photo.id} photo={photo} index={i} timing={timing} progress={progress} still={still} />
      ))}
      <LinearGradient pointerEvents="none" colors={["rgba(11,13,18,0)", "rgba(11,13,18,0.92)"]} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient pointerEvents="none" colors={["rgba(11,13,18,0.55)", "rgba(11,13,18,0)"]} locations={[0, 0.22]} style={StyleSheet.absoluteFill} />
    </PrivateView>
  );
}

function Facts({ highlights, walkingDay, delay }: { highlights: string[]; walkingDay: DailySteps | null; delay: number }) {
  const { t, formatCompactNumber } = useLocalization();
  return (
    <View style={styles.facts}>
      {highlights.map((title, i) => (
        <Animated.View key={title} entering={rise(delay + i * 160)} style={rs.row}>
          <Icon name="check" size={15} color={ACCENT} />
          <Text numberOfLines={1} style={[rs.sub, styles.fact, rs.shadow]}>
            {title}
          </Text>
        </Animated.View>
      ))}
      {walkingDay ? (
        <Animated.View entering={rise(delay + highlights.length * 160)} style={rs.row}>
          <Icon name="footprints" size={15} color={ACCENT} />
          <Text numberOfLines={1} style={[rs.sub, styles.fact, rs.shadow]}>
            {t("recap.biggestWalk", { count: Math.round(walkingDay.steps), steps: formatCompactNumber(Math.round(walkingDay.steps)) })}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * A stop's words over the map and photos: the arrival (board code, city, how you got there, nights),
 * then, over the photos, the city with what you did there and your biggest walking day.
 */
export function StopChapter({
  recap,
  index,
  photos,
  timing,
  progress,
  walkingDay,
  bottom,
}: {
  recap: TripRecap;
  index: number;
  photos: number;
  timing: StopTiming;
  progress: SharedValue<number>;
  walkingDay: DailySteps | null;
  bottom: number;
}) {
  const { t, formatDistance } = useLocalization();
  const stop = recap.facts.stops[index];
  const leg = index > 0 ? recap.facts.legs[index - 1] : null;
  const nights = recap.schedule[index]?.nights ?? 0;
  const highlights = recap.highlights[index] ?? [];
  const icon = leg?.mode ? TRANSIT_MODES.find((mode) => mode.id === leg.mode)?.icon : undefined;
  const legText = leg ? t(`recap.arrivedBy.${leg.mode ?? "other"}`, { from: shortPlace(leg.from), distance: formatDistance(leg.km) }) : t("recap.firstStop");
  const stayText = nights > 0 ? t("recap.nights", { count: nights }) : t("recap.passingThrough");

  const arrivalStyle = useAnimatedStyle(() => ({ opacity: photos > 0 ? 1 - clamp((progress.get() - timing.arrival + timing.fade) / timing.fade) : 1 }));
  const overPhotosStyle = useAnimatedStyle(() => {
    const k = clamp((progress.get() - timing.arrival) / timing.fade);
    return { opacity: k, transform: [{ translateY: (1 - k) * 14 }] };
  });

  return (
    <>
      <Animated.View style={[rs.block, { bottom }, arrivalStyle]} pointerEvents="none">
        <FlapBoard codes={[placeCode(stop.name)]} />
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[rs.headline, styles.stopName]}>
          {shortPlace(stop.name)}
        </Text>
        <View style={rs.chip}>
          <Icon name={icon ?? (leg ? "send" : "mapPin")} size={14} color={ACCENT} />
          <Text style={rs.chipText}>{legText}</Text>
        </View>
        <Text style={[rs.sub, rs.muted, rs.small]}>{[stayText, t("recap.stopKicker", { n: index + 1, total: recap.facts.stops.length })].join(" · ")}</Text>
        {photos === 0 ? <Facts highlights={highlights} walkingDay={walkingDay} delay={1100} /> : null}
      </Animated.View>
      {photos > 0 ? (
        <Animated.View style={[rs.block, { bottom }, overPhotosStyle]} pointerEvents="none">
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[rs.headline, styles.overName, rs.shadow]}>
            {shortPlace(stop.name)}
          </Text>
          <Text style={[rs.sub, styles.overSub, rs.shadow]}>{stayText}</Text>
          <Facts highlights={highlights} walkingDay={walkingDay} delay={0} />
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  stopName: { fontSize: 52, lineHeight: 58, marginTop: 6 },
  overName: { fontSize: 40, lineHeight: 46 },
  overSub: { color: c.text, marginTop: -4 },
  facts: { gap: 8, marginTop: 6 },
  fact: { color: c.text, flexShrink: 1 },
});
