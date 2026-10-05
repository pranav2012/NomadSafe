import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  SensorType,
  cancelAnimation,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useFonts } from "react-native-skia";
import { AuraButton, AuraSwitch, Icon, PressableScale, RollingNumber, showToast } from "@/atoms";
import { AURA_FONT_FILES, auraDark, auraFonts as f } from "@/constants/aura";
import { TRANSIT_MODES } from "@/features/itinerary/constants/eventTypes";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { useStartNewTrip } from "@/modules/billing";
import { selectionChanged } from "@/utils/haptics";
import { StampingMoment, type MomentItem } from "@/features/passport/components/StampingMoment";
import { useHomeCountry } from "@/features/passport/hooks/usePassport";
import { stampDate } from "@/features/passport/utils/passport";
import { regionAt } from "@/features/passport/utils/regions";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { FlapBoard } from "../components/FlapBoard";
import { RecapMapCanvas } from "../components/RecapMapCanvas";
import { CARD_HEIGHT, CARD_WIDTH, RECAP_FONT_FAMILY, encodeRecapCard, renderRecapCard } from "../components/recapCard";
import { placeCode, shortPlace, useTripRecap, type TripRecap } from "../hooks/useTripRecap";
import { shareRecapCard } from "../services/shareRecapCard";
import { shareRecapVideo } from "../services/shareRecapVideo";
import { videoEncoder } from "../services/videoEncoder";
import { finishRecap, useRecapStore } from "../store/recapStore";
import { cameraFor, frameRoute, type Camera, type Point, type Rect } from "../utils/recapMap";

type Chapter = { kind: "intro" } | { kind: "stop"; index: number } | { kind: "numbers" } | { kind: "stamp" } | { kind: "finale" };
type RecapSource = "home" | "notification" | "trips";

const c = auraDark;
const DURATION_MS: Record<Exclude<Chapter["kind"], "finale">, number> = { intro: 4200, stop: 3400, numbers: 5000, stamp: 4600 };
const CAMERA_MS = 1300;
const PREVIEW_PIXELS = 900;

function buildChapters(recap: TripRecap, stamped: boolean): Chapter[] {
  return [
    { kind: "intro" },
    ...recap.facts.stops.map((_, index): Chapter => ({ kind: "stop", index })),
    { kind: "numbers" },
    ...(stamped ? [{ kind: "stamp" } as const] : []),
    { kind: "finale" },
  ];
}

/** New passport entries for this trip: a stamp per foreign country, a seal per home state. */
function useMomentItems(recap: TripRecap): MomentItem[] {
  const { locale } = useLocalization();
  const { code: home } = useHomeCountry();
  return useMemo(() => {
    const date = stampDate(recap.trip.startDate, locale);
    const stamps: MomentItem[] = [];
    const seals: MomentItem[] = [];
    const seen = new Set<string>();
    for (const stop of recap.facts.stops) {
      if (!stop.country) continue;
      if (stop.country === home) {
        const region = regionAt(stop.country, stop.latitude, stop.longitude);
        if (!region || seen.has(region.key)) continue;
        seen.add(region.key);
        seals.push({ key: region.key, kind: "seal", seed: region.key, title: region.name, top: null, bottom: date });
      } else if (!seen.has(stop.country)) {
        seen.add(stop.country);
        stamps.push({ key: `${recap.trip.id}:${stop.country}`, kind: "stamp", seed: stop.country, title: countryDisplayName(stop.country, locale), top: shortPlace(stop.name), bottom: date });
      }
    }
    return [...stamps, ...seals];
  }, [home, locale, recap.facts.stops, recap.trip.id, recap.trip.startDate]);
}

/** Full-screen trip replay: the route draws itself stop by stop, then the numbers, then the share card. */
export default function TripRecapScreen() {
  const { id, source } = useLocalSearchParams<{ id: string; source?: RecapSource }>();
  const recap = useTripRecap(id);
  const router = useRouter();
  const { t } = useLocalization();

  useEffect(() => {
    useRecapStore.getState().setReplayOpen(true);
    return () => useRecapStore.getState().setReplayOpen(false);
  }, []);

  if (!recap) {
    return (
      <View style={[styles.root, styles.center]}>
        <AuraButton label={t("common.close")} onPress={() => router.back()} />
      </View>
    );
  }
  return <Replay recap={recap} source={source ?? "home"} />;
}

function Replay({ recap, source }: { recap: TripRecap; source: RecapSource }) {
  const { t } = useLocalization();
  const router = useRouter();
  const startNewTrip = useStartNewTrip();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const momentItems = useMomentItems(recap);
  const chapters = useMemo(() => buildChapters(recap, momentItems.length > 0), [recap, momentItems.length]);
  const last = chapters.length - 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const progress = useSharedValue(0);
  const timedIndex = useRef(-1);
  const reachedEnd = useRef(false);
  const keepTrip = useRef(false);
  const tripId = recap.trip.id;
  const chapter = chapters[index];

  const frame = useMemo(() => frameRoute(recap.facts.stops, width, height, 60), [recap.facts.stops, width, height]);
  const points = useMemo(() => recap.facts.stops.map((stop) => frame.project(stop.longitude, stop.latitude)), [frame, recap.facts.stops]);
  const camX = useSharedValue(0);
  const camY = useSharedValue(0);
  const camZoom = useSharedValue(1);
  const camera = useDerivedValue<Camera>(() => ({ x: camX.get(), y: camY.get(), zoom: camZoom.get() }));
  const reveal = useSharedValue(0);
  const mapOpacity = useSharedValue(1);

  useEffect(() => {
    track("recap_opened", { source, stops: recap.facts.stops.length });
    // Leaving after the last chapter counts as done, unless the user went to settle up on this trip.
    return () => {
      if (reachedEnd.current && !keepTrip.current) finishRecap(tripId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chapter.kind !== "finale" || reachedEnd.current) return;
    reachedEnd.current = true;
    track("recap_finished", { stops: recap.facts.stops.length });
  }, [chapter.kind, recap.facts.stops.length]);

  // Camera, route reveal and map fade for the current chapter.
  useEffect(() => {
    const ease = { duration: CAMERA_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };
    const fit = (pts: Point[], region: Rect, minSize: number, maxZoom: number) => cameraFor(pts, region, { padding: 24, minSize, maxZoom });
    let target: Camera;
    let shown = recap.facts.legs.length;
    if (chapter.kind === "intro") {
      target = fit(points, { x: 0, y: height * 0.5, width, height: height * 0.36 }, 120, 1.4);
      shown = 0;
    } else if (chapter.kind === "stop") {
      const i = chapter.index;
      target = fit(i > 0 ? [points[i - 1], points[i]] : [points[i]], { x: 0, y: insets.top + 90, width, height: height * 0.48 }, 70, 4);
      shown = i;
    } else {
      target = fit(points, { x: width * 0.38, y: insets.top + 70, width: width * 0.58, height: height * 0.24 }, 120, 1);
    }
    camX.set(withTiming(target.x, ease));
    camY.set(withTiming(target.y, ease));
    camZoom.set(withTiming(target.zoom, ease));
    reveal.set(withTiming(shown, { duration: CAMERA_MS * 1.1, easing: Easing.inOut(Easing.quad) }));
    mapOpacity.set(withTiming(chapter.kind === "finale" || chapter.kind === "stamp" ? 0 : 1, { duration: 500 }));
  }, [camX, camY, camZoom, chapter, height, insets.top, mapOpacity, points, recap.facts.legs.length, reveal, width]);

  // The chapter timer: a new chapter starts from 0; resuming continues where the pause left it.
  useEffect(() => {
    const fresh = timedIndex.current !== index;
    timedIndex.current = index;
    if (fresh) {
      cancelAnimation(progress);
      progress.set(0);
    }
    if (chapter.kind === "finale") {
      progress.set(1);
      return;
    }
    if (!playing) {
      cancelAnimation(progress);
      return;
    }
    const remaining = DURATION_MS[chapter.kind] * (1 - (fresh ? 0 : progress.get()));
    const advance = () => setIndex((current) => Math.min(current + 1, last));
    progress.set(
      withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(advance);
      }),
    );
  }, [chapter.kind, index, last, playing, progress]);

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === index) return;
    selectionChanged();
    setIndex(clamped);
  };

  const done = () => {
    finishRecap(tripId);
    router.back();
  };
  const planNext = () => {
    finishRecap(tripId);
    router.back();
    startNewTrip();
  };
  const checkBalances = () => {
    keepTrip.current = true;
    useTripsStore.getState().setActiveTrip(tripId);
    router.back();
    router.navigate("/(tabs)/expenses");
  };

  return (
    <View style={styles.root}>
      <PrivateView style={StyleSheet.absoluteFill}>
        <RecapMapCanvas
          width={width}
          height={height}
          frame={frame}
          stops={recap.facts.stops}
          legs={recap.facts.legs}
          countries={recap.facts.countries}
          camera={camera}
          reveal={reveal}
          current={chapter.kind === "stop" ? chapter.index : -1}
          opacity={mapOpacity}
        />
      </PrivateView>
      {chapter.kind === "stop" ? (
        <LinearGradient pointerEvents="none" colors={["rgba(11,13,18,0)", c.bg]} locations={[0, 0.42]} style={[styles.bottomFade, { height: height * 0.46 }]} />
      ) : null}

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.segments}>
          {chapters.map((item, i) => (
            <PressableScale
              key={`${item.kind}-${i}`}
              onPress={() => goTo(i)}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel={t("recap.chapterLabel", { n: i + 1, total: chapters.length })}
              style={styles.segmentHit}
            >
              <Segment state={i < index ? "done" : i === index ? "current" : "todo"} progress={progress} />
            </PressableScale>
          ))}
        </View>
        <View style={styles.headerRow}>
          <View style={styles.flex} />
          <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("trip.close")} style={styles.round}>
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>
      </View>

      <Animated.View key={index} entering={FadeIn.duration(380)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {chapter.kind === "intro" ? <Intro recap={recap} top={insets.top + 92} /> : null}
        {chapter.kind === "stop" ? <StopChapter recap={recap} index={chapter.index} bottom={insets.bottom + 120} /> : null}
        {chapter.kind === "numbers" ? <Numbers recap={recap} top={insets.top + 80 + height * 0.25} /> : null}
        {chapter.kind === "stamp" ? (
          <View style={[styles.block, { top: insets.top + 84 }]}>
            <StampingMoment items={momentItems} width={width - 48} onOpenPassport={() => router.push({ pathname: "/passport", params: { source: "replay" } })} />
          </View>
        ) : null}
        {chapter.kind === "finale" ? (
          <Finale recap={recap} top={insets.top + 64} bottom={insets.bottom + 20} onDone={done} onPlanNext={planNext} onCheckBalances={checkBalances} />
        ) : null}
      </Animated.View>

      {chapter.kind !== "finale" ? (
        <View style={[styles.controls, { bottom: insets.bottom + 24 }]}>
          <ControlButton icon="chevronLeft" label={t("recap.previous")} onPress={() => goTo(index - 1)} disabled={index === 0} />
          <ControlButton icon={playing ? "pause" : "play"} label={playing ? t("recap.pause") : t("recap.play")} onPress={() => setPlaying((value) => !value)} large />
          <ControlButton icon="chevronRight" label={t("recap.next")} onPress={() => goTo(index + 1)} />
        </View>
      ) : null}
    </View>
  );
}

function Intro({ recap, top }: { recap: TripRecap; top: number }) {
  const { t } = useLocalization();
  const { places } = recap;
  const codes = places.length > 1 ? [placeCode(places[0]), placeCode(places[places.length - 1])] : [placeCode(places[0] ?? "")];
  return (
    <View style={[styles.block, { top }]}>
      <Text style={styles.sub}>{t("recap.introKicker")}</Text>
      <Text numberOfLines={3} style={styles.headline}>
        {recap.headline}
      </Text>
      <View style={styles.board}>
        <FlapBoard codes={codes} />
      </View>
      <Text style={styles.sub}>{[recap.title, recap.via].filter(Boolean).join(", ")}</Text>
      <Text style={[styles.sub, styles.muted]}>{recap.dates}</Text>
    </View>
  );
}

function StopChapter({ recap, index, bottom }: { recap: TripRecap; index: number; bottom: number }) {
  const { t, formatDistance } = useLocalization();
  const stop = recap.facts.stops[index];
  const leg = index > 0 ? recap.facts.legs[index - 1] : null;
  const icon = leg?.mode ? TRANSIT_MODES.find((mode) => mode.id === leg.mode)?.icon : undefined;
  const legText = leg ? t(`recap.arrivedBy.${leg.mode ?? "other"}`, { from: shortPlace(leg.from), distance: formatDistance(leg.km) }) : t("recap.firstStop");
  return (
    <View style={[styles.block, { bottom }]}>
      <FlapBoard codes={[placeCode(stop.name)]} />
      <Text numberOfLines={2} style={[styles.headline, styles.stopName]}>
        {shortPlace(stop.name)}
      </Text>
      <View style={styles.chip}>
        <Icon name={icon ?? (leg ? "send" : "mapPin")} size={14} color="#8B97FF" />
        <Text style={styles.chipText}>{legText}</Text>
      </View>
      <Text style={[styles.sub, styles.muted, styles.small]}>{t("recap.stopKicker", { n: index + 1, total: recap.facts.stops.length })}</Text>
    </View>
  );
}

function Numbers({ recap, top }: { recap: TripRecap; top: number }) {
  const { t } = useLocalization();
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
  ];
  return (
    <View style={[styles.block, { top }]}>
      <Text style={styles.sub}>{t("recap.numbersKicker")}</Text>
      {rows.map((row, i) => (
        <Animated.View key={row.label} entering={FadeInDown.delay(180 * i).duration(420)} style={styles.numberRow}>
          <RollingNumber value={row.value} lineHeight={60} style={styles.number} />
          <Text style={[styles.sub, styles.muted]}>{row.label}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

function Finale({
  recap,
  top,
  bottom,
  onDone,
  onPlanNext,
  onCheckBalances,
}: {
  recap: TripRecap;
  top: number;
  bottom: number;
  onDone: () => void;
  onPlanNext: () => void;
  onCheckBalances: () => void;
}) {
  const { t, formatDistance } = useLocalization();
  const { width, height } = useWindowDimensions();
  const fonts = useFonts({
    [RECAP_FONT_FAMILY]: [
      AURA_FONT_FILES.InstrumentSans_400Regular,
      AURA_FONT_FILES.InstrumentSans_500Medium,
      AURA_FONT_FILES.InstrumentSans_600SemiBold,
      AURA_FONT_FILES.InstrumentSans_700Bold,
    ],
  });
  const [includeSpend, setIncludeSpend] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const cancelVideo = useRef(false);
  const contentKey = JSON.stringify(recap.cardContent(includeSpend));
  const preview = useMemo(() => {
    if (!fonts) return null;
    const image = renderRecapCard(JSON.parse(contentKey), fonts, PREVIEW_PIXELS);
    return image ? `data:image/png;base64,${encodeRecapCard(image)}` : null;
  }, [fonts, contentKey]);

  const cardHeight = Math.min(height * 0.47, (width - 96) * (CARD_HEIGHT / CARD_WIDTH));
  const cardWidth = (cardHeight * CARD_WIDTH) / CARD_HEIGHT;

  const share = async () => {
    if (!fonts || sharing) return;
    setSharing(true);
    track("recap_shared", { format: "image", spend: includeSpend && recap.spend !== null });
    const shared = await shareRecapCard(JSON.parse(contentKey), fonts, t("recap.shareDialogTitle"));
    setSharing(false);
    if (!shared) showToast(t("recap.shareFailed"));
  };

  const shareVideo = async () => {
    if (!fonts || videoProgress !== null) return;
    cancelVideo.current = false;
    setVideoProgress(0);
    track("recap_shared", { format: "video", spend: includeSpend && recap.spend !== null });
    const result = await shareRecapVideo(JSON.parse(contentKey), fonts, {
      formatDistance,
      dialogTitle: t("recap.shareDialogTitle"),
      onProgress: setVideoProgress,
      isCancelled: () => cancelVideo.current,
    });
    setVideoProgress(null);
    if (result === "failed") showToast(t("recap.videoFailed"));
  };

  return (
    <View style={[styles.finale, { paddingTop: top, paddingBottom: bottom }]}>
      <TiltCard width={cardWidth} height={cardHeight} uri={preview} label={t("recap.previewLabel")} />
      {videoProgress !== null ? (
        <View style={styles.making} accessibilityLiveRegion="polite">
          <Text style={styles.makingText}>{t("recap.makingVideo", { percent: Math.round(videoProgress * 100) })}</Text>
          <View style={styles.makingTrack}>
            <View style={[styles.makingFill, { width: `${Math.round(videoProgress * 100)}%` }]} />
          </View>
        </View>
      ) : (
        <View style={styles.finaleText}>
          <Text style={styles.wrap}>{t("recap.finaleTitle")}</Text>
          <Text style={[styles.sub, styles.center]}>{t("recap.finaleBody")}</Text>
        </View>
      )}
      {recap.spend ? (
        <View style={styles.spendRow}>
          <Text style={[styles.sub, styles.flex]}>{t("recap.includeSpend")}</Text>
          <AuraSwitch value={includeSpend} onValueChange={setIncludeSpend} accessibilityLabel={t("recap.includeSpend")} />
        </View>
      ) : null}
      <View style={styles.actions}>
        {videoProgress !== null ? (
          <AuraButton label={t("common.cancel")} variant="secondary" onPress={() => (cancelVideo.current = true)} />
        ) : (
          <>
            <AuraButton label={t("recap.shareStory")} icon="share" onPress={share} loading={sharing} disabled={!fonts} />
            <View style={styles.actionRow}>
              {videoEncoder ? <AuraButton label={t("recap.shareVideo")} icon="play" variant="secondary" size="md" onPress={shareVideo} disabled={!fonts} style={styles.flex} /> : null}
              <AuraButton label={t("recap.planNext")} variant="secondary" size="md" onPress={onPlanNext} style={styles.flex} />
            </View>
            <View style={styles.actionRow}>
              {recap.hasSplits ? <AuraButton label={t("recap.checkBalances")} variant="ghost" size="md" onPress={onCheckBalances} style={styles.flex} /> : null}
              <AuraButton label={t("recap.done")} variant="ghost" size="md" onPress={onDone} style={styles.flex} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** The card on screen, tilting with the phone so its foil catches the light; the shared image stays flat. */
function TiltCard({ width, height, uri, label }: { width: number; height: number; uri: string | null; label: string }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.set(withSpring(1, { damping: 14, stiffness: 120 }));
  }, [enter]);
  const tilt = useAnimatedStyle(() => {
    const g = gravity.sensor.get();
    const len = Math.hypot(g.x, g.y, g.z) || 1;
    const x = Math.max(-0.4, Math.min(0.4, g.x / len));
    const y = Math.max(-0.4, Math.min(0.4, g.y / len + 0.6));
    const e = enter.get();
    return {
      opacity: e,
      transform: [{ perspective: 900 }, { translateY: (1 - e) * 60 }, { rotateY: `${x * 16}deg` }, { rotateX: `${-y * 12}deg` }, { rotateZ: `${(1 - e) * -6 - 1.2}deg` }],
    };
  });
  const sheen = useAnimatedStyle(() => {
    const g = gravity.sensor.get();
    const len = Math.hypot(g.x, g.y, g.z) || 1;
    return { transform: [{ translateX: (g.x / len) * width * 1.6 }] };
  });
  return (
    <Animated.View style={[styles.card, { width, height }, tilt]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} accessibilityLabel={label} /> : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sheen]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,150,220,0.10)", "rgba(140,210,255,0.16)", "rgba(160,255,210,0.10)", "rgba(255,255,255,0)"]}
          locations={[0.3, 0.42, 0.5, 0.58, 0.7]}
          start={{ x: 0, y: 0.2 }}
          end={{ x: 1, y: 0.8 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  );
}

function Segment({ state, progress }: { state: "done" | "current" | "todo"; progress: SharedValue<number> }) {
  const animated = useAnimatedStyle(() => ({ width: `${(state === "done" ? 1 : state === "current" ? progress.get() : 0) * 100}%` }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, animated]} />
    </View>
  );
}

function ControlButton({
  icon,
  label,
  onPress,
  disabled,
  large,
}: {
  icon: "chevronLeft" | "chevronRight" | "play" | "pause";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  large?: boolean;
}) {
  const size = large ? 60 : 46;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.control, { width: size, height: size, borderRadius: size / 2, backgroundColor: large ? c.inverse : c.surfaceStrong, opacity: disabled ? 0.4 : 1 }]}
    >
      <Icon name={icon} size={large ? 22 : 18} color={large ? c.onInverse : c.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { alignItems: "center", justifyContent: "center", textAlign: "center" },
  flex: { flex: 1 },
  bottomFade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  header: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 8 },
  segments: { flexDirection: "row", gap: 4 },
  segmentHit: { flex: 1, paddingVertical: 6 },
  segment: { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: c.hairline },
  segmentFill: { height: 3, borderRadius: 2, backgroundColor: c.text },
  headerRow: { flexDirection: "row", alignItems: "center" },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceStrong },
  block: { position: "absolute", left: 24, right: 24, gap: 10 },
  sub: { fontFamily: f.regular, fontSize: 16, lineHeight: 23, color: c.textSoft },
  muted: { color: c.textMuted },
  small: { fontSize: 14 },
  headline: { fontFamily: f.semibold, fontSize: 46, lineHeight: 50, letterSpacing: -1.4, color: c.text },
  stopName: { fontSize: 52, lineHeight: 58, marginTop: 6 },
  board: { marginVertical: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: c.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.hairline,
  },
  chipText: { fontFamily: f.medium, fontSize: 14, color: c.text },
  numberRow: { marginTop: 4 },
  number: { fontFamily: f.semibold, fontSize: 58, letterSpacing: -2.4, color: c.text },
  finale: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", paddingHorizontal: 20 },
  card: { borderRadius: 20, overflow: "hidden", backgroundColor: c.card, marginTop: 8 },
  finaleText: { marginTop: 14, alignItems: "center", gap: 2 },
  wrap: { fontFamily: f.semibold, fontSize: 28, letterSpacing: -0.8, color: c.text },
  spendRow: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  actions: { alignSelf: "stretch", marginTop: "auto", gap: 10 },
  making: { alignSelf: "stretch", alignItems: "center", gap: 12, marginTop: 22, paddingHorizontal: 24 },
  makingText: { fontFamily: f.semibold, fontSize: 16, color: c.text, textAlign: "center" },
  makingTrack: { alignSelf: "stretch", height: 4, borderRadius: 2, backgroundColor: c.hairline, overflow: "hidden" },
  makingFill: { height: 4, borderRadius: 2, backgroundColor: c.text },
  actionRow: { flexDirection: "row", gap: 10 },
  controls: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22 },
  control: { alignItems: "center", justifyContent: "center" },
});
