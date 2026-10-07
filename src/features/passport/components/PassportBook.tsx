import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { AlphaType, Canvas, ColorType, Fill, ImageShader, Shader, Skia, makeImageFromView, type SkImage } from "react-native-skia";
import Animated, { Extrapolation, interpolate, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useLocalization } from "@/localization";
import { logger } from "@/modules/logger";
import { selectionChanged } from "@/utils/haptics";
import { usePageTurnSound } from "../hooks/usePageTurnSound";
import { PAGE_CURL_SKSL, foldGeometry } from "../utils/pageCurl";
import { PassportCover, PassportEndpaper, lazyEffect } from "./PassportCover";
import { PAPER_RGB } from "./PassportPaper";

const MAX_ANGLE = 105;
const SETTLE = { damping: 20, stiffness: 140, mass: 0.9 };
const WINDOW = 2;
const BLOCK = 6;
const BLOCK_LINES = 4;
const SNAPSHOT_DELAY_MS = 60;
// The curl may rise past the book's edges, so its canvas reaches this far beyond them.
const BLEED_X = 0.18;
const BLEED_Y = 0.09;
// Within this of a whole page the book counts as at rest: live pages show and the curl is off.
const EPS = 0.0005;
const CURL = lazyEffect(PAGE_CURL_SKSL);
let blank: SkImage | null = null;
// A transparent 1×1 image for empty snapshot slots, made on first use.
function blankImage() {
  return (blank ??= Skia.Image.MakeImage({ width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 }, Skia.Data.fromBytes(new Uint8Array([0, 0, 0, 0])), 4)!);
}

type Snap = { index: number; image: SkImage } | null;
type Slots = [number, number, number];

/** Whether page `index` can curl: its snapshot and the one of the page beneath are both loaded. */
function canCurl(slots: Slots, index: number, last: number) {
  "worklet";
  return index >= 1 && index < last && slots[index % 3] === index && slots[(index + 1) % 3] === index + 1;
}

function atRest(value: number) {
  "worklet";
  return Math.abs(value - Math.round(value)) <= EPS;
}

interface Props {
  pages: React.ReactNode[];
  width: number;
  height: number;
  /** Changes whenever page content changes, so cached page snapshots are retaken. */
  contentKey: string;
  turn?: SharedValue<number>;
  onPageChange?: (index: number) => void;
}

/**
 * A closed passport that opens like a hardback, then pages curl over under the finger (drag or tap an
 * edge). During a turn a Skia canvas draws both the turning page and the page beneath from snapshots
 * (the open page and its neighbours, taken at rest), opaquely over the untouched live pages, so the
 * hand-off is a single switch. Pages without snapshots swing rigidly instead.
 */
export function PassportBook({ pages, width, height, contentKey, turn: externalTurn, onPageChange }: Props) {
  const { t } = useLocalization();
  const reduceMotion = useReducedMotion();
  const animating = useAnimationsActive();
  const playTurn = usePageTurnSound();
  const count = pages.length + 1;
  const last = count - 1;
  const ownTurn = useSharedValue(0);
  const turn = externalTurn ?? ownTurn;
  const start = useSharedValue(0);
  const grabTilt = useSharedValue(0);
  const slots = useSharedValue<Slots>([-1, -1, -1]);
  const pendingSlots = useSharedValue<Slots>([-1, -1, -1]);
  const [open, setOpen] = useState(0);
  const [landedIndex, setLandedIndex] = useState(0);
  const [snaps, setSnaps] = useState<[Snap, Snap, Snap]>([null, null, null]);
  const leaves = useRef(new Map<number, View>());
  const cache = useRef(new Map<number, SkImage>());
  const landed = useRef(0);
  const keyRef = useRef(contentKey);
  const leafRefs = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => (view: View | null) => {
        if (view) leaves.current.set(index, view);
        else leaves.current.delete(index);
      }),
    [count],
  );

  // Slots switch on the UI thread only at rest, so a turn never changes images under it.
  useEffect(() => {
    pendingSlots.set([snaps[0]?.index ?? -1, snaps[1]?.index ?? -1, snaps[2]?.index ?? -1]);
  }, [pendingSlots, snaps]);

  useAnimatedReaction(
    () => ({ rest: atRest(turn.get()), pending: pendingSlots.get() }),
    (state) => {
      const current = slots.get();
      if (state.rest && state.pending.some((value, i) => value !== current[i])) slots.set(state.pending);
    },
  );

  const capture = async (index: number) => {
    if (index < 1 || index > last) return null;
    const hit = cache.current.get(index);
    if (hit) return hit;
    const view = leaves.current.get(index);
    if (!view) return null;
    try {
      const image = await makeImageFromView({ current: view });
      if (image) cache.current.set(index, image);
      return image;
    } catch (error) {
      logger.warn("passport", "page snapshot failed", error);
      return null;
    }
  };

  const prefetch = async (index: number) => {
    const key = keyRef.current;
    const images = [await capture(index), await capture(index - 1), await capture(index + 1)];
    if (keyRef.current !== key || landed.current !== index) return;
    const next: [Snap, Snap, Snap] = [null, null, null];
    [index, index - 1, index + 1].forEach((i, k) => {
      const image = images[k];
      if (image) next[i % 3] = { index: i, image };
    });
    setSnaps(next);
    const evicted = [...cache.current].filter(([i]) => Math.abs(i - index) > WINDOW);
    evicted.forEach(([i]) => cache.current.delete(i));
    setTimeout(() => evicted.forEach(([, image]) => image.dispose()), 500);
  };

  const onLanded = useEffectEvent(() => {
    const first = landed.current === landedIndex;
    if (!first) selectionChanged();
    landed.current = landedIndex;
    if (reduceMotion) return;
    const id = setTimeout(() => void prefetch(landedIndex), first ? 400 : SNAPSHOT_DELAY_MS);
    return () => clearTimeout(id);
  });
  useEffect(() => onLanded(), [landedIndex, reduceMotion]);

  const onContentChanged = useEffectEvent(() => {
    if (keyRef.current === contentKey) return;
    keyRef.current = contentKey;
    const stale = [...cache.current.values()];
    cache.current.clear();
    pendingSlots.set([-1, -1, -1]);
    const id = setTimeout(() => {
      setSnaps([null, null, null]);
      if (!reduceMotion) void prefetch(landed.current);
    }, 250);
    // Not cancelled on cleanup: these left the cache, so nothing else would free them.
    setTimeout(() => stale.forEach((image) => image.dispose()), 1000);
    return () => clearTimeout(id);
  });
  useEffect(() => onContentChanged(), [contentKey]);

  useEffect(() => {
    const images = cache.current;
    return () => {
      images.forEach((image) => image.dispose());
      images.clear();
    };
  }, []);

  const settle = (target: number) => {
    "worklet";
    const clamped = Math.max(0, Math.min(last, target));
    if (clamped !== Math.round(start.get()) && !reduceMotion) scheduleOnRN(playTurn);
    turn.set(
      withSpring(clamped, SETTLE, (finished) => {
        if (finished) scheduleOnRN(setLandedIndex, clamped);
      }),
    );
  };

  // The mounted window moves only while a page lies flat, never mid-turn.
  useAnimatedReaction(
    () => (atRest(turn.get()) ? Math.round(turn.get()) : -1),
    (index, previous) => {
      if (index < 0 || index === previous) return;
      scheduleOnRN(setOpen, index);
    },
  );

  useAnimatedReaction(
    () => Math.round(turn.get()),
    (index, previous) => {
      if (previous === null || index === previous) return;
      if (onPageChange) scheduleOnRN(onPageChange, index);
    },
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onBegin((event) => {
      start.set(turn.get());
      grabTilt.set(Math.max(-1, Math.min(1, (event.y - height / 2) / (height / 2))));
    })
    .onUpdate((event) => {
      const next = start.get() - event.translationX / (width * 0.85);
      turn.set(next < 0 ? next * 0.25 : next > last ? last + (next - last) * 0.25 : next);
    })
    .onEnd((event) => {
      const from = start.get();
      const moved = turn.get() - from;
      const fling = -event.velocityX / width;
      const target = Math.abs(fling) > 0.6 ? from + Math.sign(fling) : Math.abs(moved) > 0.3 ? from + Math.sign(moved) : from;
      settle(Math.round(target));
    });

  const tap = Gesture.Tap().onEnd((event) => {
    const current = Math.round(turn.get());
    start.set(current);
    grabTilt.set(0);
    settle(current === 0 || event.x > width * 0.62 ? current + 1 : event.x < width * 0.25 ? current - 1 : current);
  });

  const step = (delta: number) => {
    const current = Math.round(turn.get());
    start.set(current);
    grabTilt.set(0);
    settle(current + delta);
  };

  const accessibilityLabel = open === 0 ? t("passport.coverA11y") : t("passport.pageA11y", { page: open, total: last });

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        style={{ width, height }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={open === 0 ? t("passport.openA11y") : undefined}
        accessibilityActions={[
          { name: "increment", label: open === 0 ? t("passport.openA11y") : undefined },
          { name: "decrement", label: open === 1 ? t("passport.closeA11y") : undefined },
        ]}
        onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
      >
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shadow]} />
        <Binding turn={turn} height={height} />
        <PageBlock turn={turn} last={last} height={height} width={width} />
        <View style={StyleSheet.absoluteFill}>
          {Array.from({ length: count }, (_, index) =>
            Math.abs(index - open) <= WINDOW ? (
              <Leaf
                key={index}
                index={index}
                count={count}
                last={last}
                turn={turn}
                slots={slots}
                width={width}
                height={height}
                reduceMotion={reduceMotion}
                onRef={leafRefs[index]}
                coverLive={index === 0 && open === 0 && animating && !reduceMotion}
              >
                {index === 0 ? null : pages[index - 1]}
              </Leaf>
            ) : null,
          )}
        </View>
        {reduceMotion ? null : <Curl zIndex={count + 1} turn={turn} slots={slots} grabTilt={grabTilt} snaps={snaps} last={last} width={width} height={height} />}
      </View>
    </GestureDetector>
  );
}

/** The Skia overlay: always mounted and visible, transparent at rest, the whole turn while curling. */
function Curl({
  zIndex,
  turn,
  slots,
  grabTilt,
  snaps,
  last,
  width,
  height,
}: {
  zIndex: number;
  turn: SharedValue<number>;
  slots: SharedValue<Slots>;
  grabTilt: SharedValue<number>;
  snaps: [Snap, Snap, Snap];
  last: number;
  width: number;
  height: number;
}) {
  const bleedX = Math.round(width * BLEED_X);
  const bleedY = Math.round(height * BLEED_Y);
  const offset = [bleedX, bleedY];
  const idle = (warm: number) => {
    "worklet";
    return {
      res: [width, height],
      origin: [width * 4, 0],
      dir: [1, 0],
      radius: 1,
      sel: 0,
      under: 1,
      shadow: 0,
      paper: PAPER_RGB,
      offset,
      visible: 0,
      warm,
    };
  };
  const uniforms = useSharedValue(idle(0));
  const version = useSharedValue(0);

  useEffect(() => {
    version.set(version.get() + 1);
  }, [snaps, version]);

  useAnimatedReaction(
    () => {
      const value = turn.get();
      const index = Math.floor(value);
      const progress = value - index;
      const on = progress > EPS && progress < 1 - EPS && canCurl(slots.get(), index, last);
      return { on, index, progress, tilt: grabTilt.get(), version: version.get() };
    },
    (state, previous) => {
      if (!state.on) {
        // One idle draw samples every snapshot, so each is on the GPU before its first curl.
        if (previous?.on || state.version !== previous?.version) uniforms.set(idle(state.version % 2));
        return;
      }
      const fold = foldGeometry(state.progress, state.tilt, width, height);
      uniforms.set({
        res: [width, height],
        origin: fold.origin,
        dir: fold.dir,
        radius: fold.radius,
        sel: state.index % 3,
        under: (state.index + 1) % 3,
        shadow: Math.min(1, (1 - state.progress) * 3),
        paper: PAPER_RGB,
        offset,
        visible: 1,
        warm: 0,
      });
    },
  );

  return (
    <View pointerEvents="none" style={[styles.bleed, { zIndex, left: -bleedX, top: -bleedY, width: width + bleedX * 2, height: height + bleedY * 2 }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={CURL()} uniforms={uniforms}>
            {snaps.map((snap, i) => (
              <ImageShader key={i} image={snap?.image ?? blankImage()} fit="fill" x={0} y={0} width={width} height={height} />
            ))}
          </Shader>
        </Fill>
      </Canvas>
    </View>
  );
}

/** The stacked page edges at the fore-edge, flush with the page, thinning as you read; hidden behind the closed cover. */
function PageBlock({ turn, last, width, height }: { turn: SharedValue<number>; last: number; width: number; height: number }) {
  const style = useAnimatedStyle(() => {
    const value = turn.get();
    const read = Math.max(0, Math.min(last, value)) / Math.max(1, last);
    return { opacity: Math.min(1, Math.max(0, (value - 0.5) * 2.5)), transform: [{ translateX: 1 + (BLOCK - 1) * (1 - read) }] };
  });
  const lines = Array.from({ length: BLOCK_LINES }, (_, i) => <View key={i} style={[styles.blockLine, { right: 1 + i * 1.4 }]} />);
  return (
    <Animated.View pointerEvents="none" style={[styles.leaf, styles.block, { width, height: height - 5 }, style]}>
      {lines}
    </Animated.View>
  );
}

/** The dark binding along the spine of the open book. */
function Binding({ turn, height }: { turn: SharedValue<number>; height: number }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, (turn.get() - 0.5) * 2.5)) }));
  return <Animated.View pointerEvents="none" style={[styles.binding, { height: height - 4 }, style]} />;
}

// Memoised: re-rendering a leaf re-applies its JS-side animated style for a frame, which flashes on Android.
const Leaf = React.memo(function Leaf({
  index,
  count,
  last,
  turn,
  slots,
  width,
  height,
  reduceMotion,
  onRef,
  coverLive,
  children,
}: {
  index: number;
  count: number;
  last: number;
  turn: SharedValue<number>;
  slots: SharedValue<Slots>;
  width: number;
  height: number;
  reduceMotion: boolean;
  onRef: (view: View | null) => void;
  coverLive: boolean;
  children: React.ReactNode;
}) {
  const isCover = index === 0;
  const rigid = (i: number) => {
    "worklet";
    return i === 0 || !canCurl(slots.get(), i, last);
  };
  const style = useAnimatedStyle(() => {
    const value = turn.get();
    const progress = Math.max(0, Math.min(1, value - index));
    if (reduceMotion) return { opacity: 1 - progress, transform: [{ perspective: 1600 }, { translateX: 0 }, { rotateY: "0deg" }, { translateX: 0 }] };
    // Only opacity and transform change here (applied in the same frame); zIndex stays static,
    // since a zIndex change lands a frame or two late on Android and flashes the wrong page.
    let angle = 0;
    let opacity = 1;
    if (progress >= 1 - EPS) opacity = 0;
    else if (progress > EPS && rigid(index)) angle = isCover ? -180 * progress : -MAX_ANGLE * progress;
    // While curling, the canvas covers the page; underneath, keep whichever rest state is nearer so a
    // canvas frame that lands late at either end shows the same page.
    else if (progress >= 0.5) opacity = 0;
    return { opacity, transform: [{ perspective: 1600 }, { translateX: -width / 2 }, { rotateY: `${angle}deg` }, { translateX: width / 2 }] };
  });
  const turnShade = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, turn.get() - index));
    if (progress >= 1 - EPS || progress <= EPS || !rigid(index)) return { opacity: 0 };
    return { opacity: interpolate(isCover ? Math.min(progress, 1 - progress) * 2 : progress, [0, 0.9], [0, 0.55], Extrapolation.CLAMP) };
  });
  const underShade = useAnimatedStyle(() => {
    const above = turn.get() - (index - 1);
    if (index === 0 || !rigid(index - 1) || above <= EPS || above >= 1 - EPS) return { opacity: 0 };
    return { opacity: interpolate(above, [0, 0.15, 1], [0, 0.5, 0], Extrapolation.CLAMP) };
  });
  const front = useAnimatedStyle(() => ({ opacity: turn.get() - index < 0.5 ? 1 : 0 }));
  const back = useAnimatedStyle(() => ({ opacity: turn.get() - index < 0.5 ? 0 : 1 }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { width, height, zIndex: count - index }, !isCover && styles.backface, style]}>
      {/* The snapshot is taken of this inner view, which keeps full opacity while its leaf is hidden. */}
      <View ref={onRef} collapsable={false} style={[StyleSheet.absoluteFill, styles.leaf, isCover ? styles.cover : styles.page]}>
        {isCover ? (
          <>
            <Animated.View style={[StyleSheet.absoluteFill, front]}>
              <PassportCover width={width} height={height} turn={turn} live={coverLive} />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rim]} />
              <View pointerEvents="none" style={styles.rimLight} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.mirror, back]}>
              <PassportEndpaper width={width} height={height} />
            </Animated.View>
          </>
        ) : (
          <>
            {children}
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(40,34,20,0.26)", "rgba(40,34,20,0.08)", "rgba(40,34,20,0)"]}
              locations={[0, 0.05, 0.14]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shadeDark, turnShade]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, underShade]}>
          <LinearGradient colors={["rgba(0,0,0,0.6)", "rgba(0,0,0,0)"]} start={{ x: 0, y: 0.5 }} end={{ x: 0.6, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  leaf: { borderTopRightRadius: 28, borderBottomRightRadius: 28, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, overflow: "hidden" },
  page: { borderWidth: 1, borderColor: "rgba(29,34,48,0.2)", backgroundColor: "#F2EFE6" },
  backface: { backfaceVisibility: "hidden" },
  cover: { backgroundColor: "#11163A" },
  mirror: { transform: [{ scaleX: -1 }] },
  shadow: { borderTopRightRadius: 28, borderBottomRightRadius: 28, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, backgroundColor: "#0B0E14", boxShadow: "0px 18px 32px rgba(0,0,0,0.55)" },
  block: { position: "absolute", left: 0, top: 2.5, backgroundColor: "#E6E0D0", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(70,60,40,0.35)" },
  binding: { position: "absolute", left: -2.5, top: 2, width: 3, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, backgroundColor: "#151A33" },
  blockLine: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: "rgba(70,60,40,0.28)" },
  rim: { borderTopRightRadius: 28, borderBottomRightRadius: 28, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, borderRightWidth: 3, borderBottomWidth: 3, borderColor: "rgba(0,0,0,0.42)" },
  rimLight: { position: "absolute", top: 10, bottom: 12, right: 3, width: 1, backgroundColor: "rgba(255,255,255,0.10)" },
  bleed: { position: "absolute" },
  shadeDark: { backgroundColor: "#000" },
});
