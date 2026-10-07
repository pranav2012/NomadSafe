import React, { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedReaction, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { AuraButton, Icon, PressableScale } from "@/atoms";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { useStartNewTrip } from "@/modules/billing";
import { selectionChanged } from "@/utils/haptics";
import { StampingMoment, type MomentItem } from "@/features/passport/components/StampingMoment";
import { useHomeCountry, usePassport } from "@/features/passport/hooks/usePassport";
import { stampDate } from "@/features/passport/utils/passport";
import { regionAt } from "@/features/passport/utils/regions";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { RecapMapCanvas } from "../components/RecapMapCanvas";
import { Finale } from "../components/replay/Finale";
import { IntroChapter } from "../components/replay/IntroChapter";
import { PhotoEditorSheet } from "../components/replay/PhotoEditorSheet";
import { PrepScreen } from "../components/replay/PrepScreen";
import { ReplayHeader, TapZones } from "../components/replay/ReplayChrome";
import { CompanionsChapter, CountriesChapter, DistanceChapter, NumbersChapter } from "../components/replay/StatChapters";
import { StopChapter, StopPhotos, type StopTiming } from "../components/replay/StopChapter";
import { c, rs } from "../components/replay/replayStyles";
import { afterSheet, useRecapExtras } from "../hooks/useRecapExtras";
import { recapTrack, useReplayMusic } from "../hooks/useReplayMusic";
import { usePhotoCuration, type PhotoCuration } from "../hooks/usePhotoCuration";
import { shortPlace, useTripRecap, type TripRecap } from "../hooks/useTripRecap";
import { useTripWalking } from "../hooks/useTripWalking";
import { finishRecap, useRecapStore } from "../store/recapStore";
import { photosByStop } from "../utils/photoCuration";
import { cameraFor, frameRoute, type Camera, type Point, type Rect } from "../utils/recapMap";
import { biggestWalkingDays, countryMilestones } from "../utils/replayFacts";
import { chapterMs, replayChapters, stopPhases } from "../utils/replayChapters";

type RecapSource = "home" | "notification" | "trips";

const CAMERA_MS = 1300;
const PHOTO_FADE_MS = 450;

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
        stamps.push({
          key: `${recap.trip.id}:${stop.country}`,
          kind: "stamp",
          seed: stop.country,
          title: countryDisplayName(stop.country, locale),
          top: shortPlace(stop.name),
          bottom: date,
        });
      }
    }
    return [...stamps, ...seals];
  }, [home, locale, recap.facts.stops, recap.trip.id, recap.trip.startDate]);
}

/** Full-screen trip replay: "make it yours" first (photos, steps), then the film, then the share card. */
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
  return <RecapFlow recap={recap} source={source ?? "home"} />;
}

function RecapFlow({ recap, source }: { recap: TripRecap; source: RecapSource }) {
  const router = useRouter();
  const tripId = recap.trip.id;
  const prepped = useRecapStore((state) => Boolean(state.prepped[tripId]));
  const [stage, setStage] = useState<"prep" | "replay">(prepped ? "replay" : "prep");
  const [editing, setEditing] = useState(false);
  const curation = usePhotoCuration(recap);
  const walking = useTripWalking(recap.trip);
  const extras = useRecapExtras(curation, walking);

  const onOpened = useEffectEvent(() => {
    track("recap_opened", { source, stops: recap.facts.stops.length });
  });
  useEffect(() => onOpened(), []);

  const play = (skipped: boolean) => {
    useRecapStore.getState().markPrepped(tripId);
    track("recap_prepared", { action: skipped ? "skip" : "play", photos: curation.photos.length, steps: Boolean(walking.totals) });
    setStage("replay");
  };

  const pickMore = async () => {
    setEditing(false);
    // Two modals in a row: wait for the editor's to be fully gone before the next one presents on iOS.
    await afterSheet();
    await afterSheet();
    extras.askPhotos();
  };

  return (
    <View style={styles.root}>
      {stage === "prep" ? (
        <PrepScreen
          recap={recap}
          curation={curation}
          walking={walking}
          onPickPhotos={extras.askPhotos}
          onEditPhotos={() => setEditing(true)}
          onLinkSteps={extras.askSteps}
          onPlay={play}
          onClose={() => router.back()}
        />
      ) : (
        <Replay recap={recap} curation={curation} walking={walking.totals} paused={editing} onEditPhotos={() => setEditing(true)} />
      )}
      <PhotoEditorSheet visible={editing} onClose={() => setEditing(false)} recap={recap} curation={curation} onPickMore={() => void pickMore()} />
      {extras.sheets}
    </View>
  );
}

function Replay({
  recap,
  curation,
  walking,
  paused,
  onEditPhotos,
}: {
  recap: TripRecap;
  curation: PhotoCuration;
  walking: ReturnType<typeof useTripWalking>["totals"];
  paused: boolean;
  onEditPhotos: () => void;
}) {
  const { t, formatCompactNumber } = useLocalization();
  const router = useRouter();
  const startNewTrip = useStartNewTrip();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();
  const muted = useRecapStore((state) => state.muted);
  const passport = usePassport();
  const { code: home } = useHomeCountry();
  const momentItems = useMomentItems(recap);
  const tripId = recap.trip.id;

  const perStop = useMemo(() => photosByStop(curation.photos, recap.facts.stops, recap.schedule), [curation.photos, recap.facts.stops, recap.schedule]);
  const walkingDays = useMemo(() => biggestWalkingDays(walking?.daily ?? [], recap.schedule), [walking?.daily, recap.schedule]);
  const milestones = useMemo(
    () => countryMilestones(passport.stamps, tripId, home, recap.facts.countries),
    [passport.stamps, tripId, home, recap.facts.countries],
  );
  const chapters = useMemo(
    () =>
      replayChapters({
        photosPerStop: perStop.map((list) => list.length),
        highlightsPerStop: recap.highlights.map((list, i) => list.length + (walkingDays[i] ? 1 : 0)),
        totalKm: recap.facts.totalKm,
        countries: milestones.firstTime.length > 0 || recap.facts.countries.length >= 2,
        companions: recap.companions.length > 0,
        stamped: momentItems.length > 0,
      }),
    [perStop, recap.highlights, recap.facts.totalKm, recap.facts.countries.length, recap.companions.length, walkingDays, milestones.firstTime.length, momentItems.length],
  );
  const last = chapters.length - 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const shownLast = useRef(last);
  const progress = useSharedValue(0);
  const timedIndex = useRef(-1);
  const reachedEnd = useRef(false);
  const keepTrip = useRef(false);
  const chapter = chapters[Math.min(index, last)];
  const running = playing && !held && !paused && chapter.kind !== "finale";
  const durationMs = chapterMs(chapter);

  useReplayMusic(tripId, running && !muted);

  const frame = useMemo(() => frameRoute(recap.facts.stops, width, height, 60), [recap.facts.stops, width, height]);
  const points = useMemo(() => recap.facts.stops.map((stop) => frame.project(stop.longitude, stop.latitude)), [frame, recap.facts.stops]);
  const camX = useSharedValue(0);
  const camY = useSharedValue(0);
  const camZoom = useSharedValue(1);
  const camera = useDerivedValue<Camera>(() => ({ x: camX.get(), y: camY.get(), zoom: camZoom.get() }));
  const reveal = useSharedValue(0);
  const mapOpacity = useSharedValue(1);

  const stopPhotos = chapter.kind === "stop" ? perStop[chapter.index] : [];
  const phases = stopPhases(stopPhotos.length);
  const timing: StopTiming = { arrival: phases.arrival, photo: phases.photo, fade: durationMs > 0 ? PHOTO_FADE_MS / durationMs : 0.1 };
  const insetWidth = width * 0.34;
  const insetRect: Rect = { x: width - 16 - insetWidth, y: insets.top + 84, width: insetWidth, height: insetWidth * 1.15 };
  const focus: Point | null = chapter.kind === "stop" ? points[chapter.index] : null;
  const withPhotos = stopPhotos.length > 0;
  const inset = useDerivedValue(() => (withPhotos ? Math.min(1, Math.max(0, (progress.get() - timing.arrival + timing.fade) / timing.fade)) : 0));
  // The photos follow the chapter's progress, but keep their last frame when the chapter changes so
  // they can fade out instead of blinking off.
  const photoProgress = useSharedValue(0);
  const followPhotos = useSharedValue(false);
  useLayoutEffect(() => {
    followPhotos.set(withPhotos);
    if (withPhotos) photoProgress.set(0);
  }, [followPhotos, index, photoProgress, withPhotos]);
  useAnimatedReaction(
    () => progress.get(),
    (p) => {
      if (followPhotos.get()) photoProgress.set(p);
    },
  );

  useEffect(() => {
    return () => {
      // Leaving after the last chapter counts as done, unless the user went to settle up on this trip.
      if (reachedEnd.current && !keepTrip.current) finishRecap(tripId);
    };
  }, [tripId]);

  useEffect(() => {
    if (chapter.kind !== "finale" || reachedEnd.current) return;
    reachedEnd.current = true;
    track("recap_finished", { stops: recap.facts.stops.length });
  }, [chapter.kind, recap.facts.stops.length]);

  const kind = chapter.kind;
  const stopIndex = chapter.kind === "stop" ? chapter.index : -1;
  // Camera, route reveal and map fade for the current chapter.
  useEffect(() => {
    const ease = { duration: still ? 0 : CAMERA_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };
    const fit = (pts: Point[], region: Rect, minSize: number, maxZoom: number) => cameraFor(pts, region, { padding: 24, minSize, maxZoom });
    let target: Camera;
    let shown = recap.facts.legs.length;
    if (kind === "intro") {
      target = fit(points, { x: 0, y: height * 0.5, width, height: height * 0.36 }, 120, 1.4);
      shown = 0;
    } else if (stopIndex >= 0) {
      const i = stopIndex;
      target = fit(i > 0 ? [points[i - 1], points[i]] : [points[i]], { x: 0, y: insets.top + 90, width, height: height * 0.48 }, 70, 4);
      shown = i;
    } else {
      target = fit(points, { x: width * 0.38, y: insets.top + 70, width: width * 0.58, height: height * 0.24 }, 120, 1);
    }
    camX.set(withTiming(target.x, ease));
    camY.set(withTiming(target.y, ease));
    camZoom.set(withTiming(target.zoom, ease));
    reveal.set(withTiming(shown, { duration: still ? 0 : CAMERA_MS * 1.1, easing: Easing.inOut(Easing.quad) }));
    mapOpacity.set(withTiming(kind === "finale" || kind === "stamp" ? 0 : 1, { duration: 500 }));
  }, [camX, camY, camZoom, kind, stopIndex, height, insets.top, mapOpacity, points, recap.facts.legs.length, reveal, still, width]);

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
    if (!running) {
      cancelAnimation(progress);
      return;
    }
    const remaining = durationMs * (1 - (fresh ? 0 : progress.get()));
    const advance = () => setIndex((current) => Math.min(current + 1, last));
    progress.set(
      withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(advance);
      }),
    );
  }, [chapter.kind, durationMs, index, last, progress, running]);

  // Photo edits change the chapter count; stay on the finale if that's where we were.
  useLayoutEffect(() => {
    if (shownLast.current === last) return;
    const previousLast = shownLast.current;
    shownLast.current = last;
    setIndex((current) => (current === previousLast ? last : Math.min(current, last)));
  }, [last]);

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === index) return;
    selectionChanged();
    setIndex(clamped);
  };

  const toggleMute = () => {
    useRecapStore.getState().setMuted(!muted);
    track("recap_music", { muted: !muted });
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

  const statFrame = { top: insets.top + 80 + height * 0.25, bottom: insets.bottom + 48 };
  const steps = walking ? Math.round(walking.steps) : 0;
  const card = recap.cardContent(false);
  const video = {
    kicker: t("recap.introKicker"),
    headline: recap.headline,
    dates: recap.dates,
    brand: card.brand,
    stops: recap.facts.stops.map((stop, i) => {
      const nights = recap.schedule[i]?.nights ?? 0;
      return { name: shortPlace(stop.name), detail: nights > 0 ? t("recap.nights", { count: nights }) : "" };
    }),
    numbers: [
      ...card.stats.filter((stat) => stat.count !== undefined),
      ...(steps > 0 ? [{ value: formatCompactNumber(steps), label: t("recap.steps", { count: steps }) }] : []),
    ],
    photos: perStop.map((list) => list.map((photo) => photo.uri)),
    music: recapTrack(tripId),
  };

  return (
    <View style={styles.root}>
      {chapter.kind === "stop" && withPhotos ? (
        // Fades out rather than vanishing, so the map growing back never shows an empty frame.
        <Animated.View key={`photos-${index}`} exiting={FadeOut.duration(300)} style={StyleSheet.absoluteFill}>
          <StopPhotos photos={stopPhotos} timing={timing} progress={photoProgress} still={still} />
        </Animated.View>
      ) : null}
      <PrivateView style={StyleSheet.absoluteFill} pointerEvents="none">
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
          inset={inset}
          insetRect={insetRect}
          focus={focus}
        />
      </PrivateView>
      {chapter.kind === "stop" && !withPhotos ? (
        <LinearGradient pointerEvents="none" colors={["rgba(11,13,18,0)", c.bg]} locations={[0, 0.42]} style={[styles.bottomFade, { height: height * 0.5 }]} />
      ) : null}
      {chapter.kind !== "finale" ? (
        <TapZones
          onPrevious={() => goTo(index - 1)}
          onNext={() => goTo(index + 1)}
          onHold={setHeld}
          onTogglePlay={() => setPlaying((value) => !value)}
          playing={playing}
        />
      ) : null}

      <Animated.View
        key={index}
        entering={FadeIn.duration(320)}
        // Crossfade with the chapter before, so there's never an empty frame between them.
        exiting={FadeOut.duration(240)}
        style={StyleSheet.absoluteFill}
        // Words only: taps fall through to the tap zones, except where a chapter has buttons.
        pointerEvents={chapter.kind === "finale" || chapter.kind === "stamp" ? "box-none" : "none"}
      >
        {chapter.kind === "intro" ? <IntroChapter recap={recap} top={insets.top + 92} /> : null}
        {chapter.kind === "stop" ? (
          <StopChapter
            recap={recap}
            index={chapter.index}
            photos={stopPhotos.length}
            timing={timing}
            progress={progress}
            walkingDay={walkingDays[chapter.index] ?? null}
            bottom={insets.bottom + 56}
          />
        ) : null}
        {chapter.kind === "distance" ? <DistanceChapter recap={recap} frame={statFrame} /> : null}
        {chapter.kind === "countries" ? <CountriesChapter recap={recap} milestones={milestones} frame={statFrame} /> : null}
        {chapter.kind === "companions" ? <CompanionsChapter recap={recap} frame={statFrame} /> : null}
        {chapter.kind === "numbers" ? <NumbersChapter recap={recap} walking={walking} frame={statFrame} /> : null}
        {chapter.kind === "stamp" ? (
          <View style={[rs.block, { top: insets.top + 84 }]}>
            <StampingMoment items={momentItems} width={width - 48} onOpenPassport={() => router.push({ pathname: "/passport", params: { source: "replay" } })} />
          </View>
        ) : null}
        {chapter.kind === "finale" ? (
          <Finale
            recap={recap}
            video={video}
            top={insets.top + 64}
            bottom={insets.bottom + 20}
            onPlanNext={planNext}
            onCheckBalances={checkBalances}
            onEditPhotos={onEditPhotos}
          />
        ) : null}
      </Animated.View>

      <ReplayHeader
        count={chapters.length}
        index={index}
        progress={progress}
        top={insets.top}
        hidden={held}
        muted={muted}
        onJump={goTo}
        onToggleMute={toggleMute}
        onClose={() => router.back()}
      />
      {!playing && chapter.kind !== "finale" ? (
        <PressableScale onPress={() => setPlaying(true)} accessibilityRole="button" accessibilityLabel={t("recap.play")} style={[styles.paused, { bottom: insets.bottom + 18 }]}>
          <Icon name="play" size={14} color={c.onInverse} />
          <Text style={styles.pausedText}>{t("recap.paused")}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { alignItems: "center", justifyContent: "center" },
  bottomFade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  paused: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: c.inverse,
  },
  pausedText: { fontFamily: rs.chipText.fontFamily, fontSize: 14, color: c.onInverse },
});
