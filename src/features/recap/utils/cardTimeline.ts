/** How far each part of the share card has animated in; the static card is `CARD_FINAL`. */
export interface CardAnim {
  /** 0..1: the ticket slides up and fades in. */
  ticket: number;
  /** Seconds since the departure board started flipping; Infinity once settled. */
  flapTime: number;
  text: number;
  land: number;
  /** Legs drawn so far: 1.5 is the first leg and half of the second. */
  route: number;
  /** 0..1: the stamp slams down. */
  stamp: number;
  /** 0..1: the numbers count up. */
  stats: number;
  footer: number;
}

export const VIDEO_FPS = 30;
/** How long the card takes to build itself at its own pace; the video plays it faster. */
export const CARD_BUILD_SECONDS = 8.2;
export const FLAP_STEP_SECONDS = 0.06;
const FLAP_SETTLE_SECONDS = 0.5;
const FLAP_STAGGER_SECONDS = 0.12;

export const CARD_FINAL: CardAnim = { ticket: 1, flapTime: Infinity, text: 1, land: 1, route: Infinity, stamp: 1, stats: 1, footer: 1 };

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - clamp(value)) ** 3;
const easeInOut = (value: number) => {
  const v = clamp(value);
  return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2;
};
const span = (t: number, from: number, to: number) => (t - from) / (to - from);

/** The card's animation `t` seconds after it starts building; from `CARD_BUILD_SECONDS` on it is the static card. */
export function cardTimeline(t: number, legs: number): CardAnim {
  return {
    ticket: easeOut(span(t, 0, 0.6)),
    flapTime: t >= 3 ? Infinity : Math.max(0, t - 0.4),
    text: easeOut(span(t, 1.6, 2.2)),
    land: easeOut(span(t, 2.1, 2.7)),
    route: t >= 5.8 ? Infinity : legs * easeInOut(span(t, 2.4, 5.8)),
    stamp: clamp(span(t, 6.0, 6.35)),
    stats: easeOut(span(t, 6.4, 7.9)),
    footer: easeOut(span(t, 7.6, 8.2)),
  };
}

/** Whether tile `index` of the departure board has stopped on its letter. */
export function flapSettled(flapTime: number, index: number): boolean {
  return flapTime >= FLAP_SETTLE_SECONDS + index * FLAP_STAGGER_SECONDS;
}

/** The random letter tile `index` shows while flipping, fixed per flip step so frames are reproducible. */
export function flapLetter(flapTime: number, index: number): string {
  const step = Math.floor(flapTime / FLAP_STEP_SECONDS);
  const hash = Math.imul(step * 31 + index * 7919, 2654435761) >>> 0;
  return String.fromCharCode(65 + (hash % 26));
}

/** The stamp's scale while it slams: from 2.2 down past 1, then a small settle. */
export function stampScale(stamp: number): number {
  if (stamp >= 1) return 1;
  return 2.2 - 1.25 * easeOut(stamp / 0.85) + (stamp > 0.85 ? 0.05 * (stamp - 0.85) / 0.15 : 0);
}

const INTRO_SECONDS = 1.6;
const ROUTE_SECONDS = 0.8;
const PHOTO_SECONDS = 1.35;
const CROSSFADE_SECONDS = 0.3;
const NUMBERS_SECONDS = 2.0;
const CARD_SECONDS = 3.2;
const HOLD_SECONDS = 2.5;
const BODY_MAX_SECONDS = 11;
const MIN_SECONDS = 15;
export const VIDEO_PHOTOS_PER_STOP = 2;

export interface VideoPlan {
  duration: number;
  /** Per stop: the leg into it draws during `route`, then its photos play one after another. */
  stops: { route: [number, number]; photos: [number, number][] }[];
  numbers: [number, number];
  card: [number, number];
}

/**
 * Lays out the shared video (~15–20 s): intro, then each stop's leg and up to two photos, the
 * numbers, and the trip pass building itself and holding. Photos are dropped (second ones first)
 * when there are too many stops to fit.
 */
export function planVideo(photosPerStop: number[]): VideoPlan {
  const stops = photosPerStop.length;
  const route = stops > 0 ? Math.min(ROUTE_SECONDS, 5 / stops) : 0;
  const budget = Math.max(0, Math.floor((BODY_MAX_SECONDS - route * stops) / PHOTO_SECONDS));
  const counts = photosPerStop.map(() => 0);
  let left = budget;
  for (let round = 0; round < VIDEO_PHOTOS_PER_STOP && left > 0; round += 1) {
    const open = photosPerStop.flatMap((available, i) => (available > round ? [i] : []));
    // Too few slots for every stop: spread them along the route.
    const picked = open.length <= left ? open : Array.from({ length: left }, (_, k) => open[Math.floor(((k + 0.5) * open.length) / left)]);
    for (const i of picked) counts[i] += 1;
    left -= picked.length;
  }
  const photoTotal = counts.reduce((sum, n) => sum + n, 0);
  const body = route * stops + photoTotal * PHOTO_SECONDS;
  // Short trips draw their route more slowly so the video still runs about 15 s.
  const stretch = stops > 0 ? Math.max(0, MIN_SECONDS - (INTRO_SECONDS + body + NUMBERS_SECONDS + CARD_SECONDS + HOLD_SECONDS)) / stops : 0;
  let t = INTRO_SECONDS;
  const plan: VideoPlan["stops"] = counts.map((count) => {
    const routeSpan: [number, number] = [t, t + route + stretch];
    t = routeSpan[1];
    const photos: [number, number][] = [];
    for (let i = 0; i < count; i += 1) {
      photos.push([t, t + PHOTO_SECONDS]);
      t += PHOTO_SECONDS;
    }
    return { route: routeSpan, photos };
  });
  const numbers: [number, number] = [t, t + NUMBERS_SECONDS];
  const card: [number, number] = [numbers[1], numbers[1] + CARD_SECONDS];
  return { duration: card[1] + HOLD_SECONDS, stops: plan, numbers, card };
}

export interface VideoFrame {
  /** 0..1: the title over the map at the start. */
  intro: number;
  map: number;
  /** Legs drawn so far, as for the card's `route`. */
  route: number;
  /** The stop being reached, for its label; -1 before the first. */
  focus: number;
  /** Photos on screen (two while crossfading), each with its Ken Burns zoom and pan (-1..1). */
  photos: { stop: number; slot: number; alpha: number; zoom: number; panX: number; panY: number; caption: number }[];
  numbers: number;
  /** 0..1 count-up of the numbers. */
  count: number;
  cardAlpha: number;
  card: CardAnim;
}

/** Everything drawn at `t` seconds into the video planned by `plan`; at the end it is exactly the static card. */
export function videoFrameAt(plan: VideoPlan, t: number): VideoFrame {
  const photos: VideoFrame["photos"] = [];
  let route = 0;
  let focus = -1;
  plan.stops.forEach((stop, i) => {
    if (t >= stop.route[0]) focus = i;
    if (i > 0) route += clamp(span(t, stop.route[0], stop.route[1]));
    stop.photos.forEach(([start, end], slot) => {
      const fadeIn = clamp(span(t, start - CROSSFADE_SECONDS, start));
      const fadeOut = 1 - clamp(span(t, end - CROSSFADE_SECONDS, end));
      const last = slot === stop.photos.length - 1;
      const alpha = Math.min(fadeIn, last ? fadeOut : t < end ? 1 : fadeOut);
      if (alpha <= 0) return;
      const p = clamp(span(t, start - CROSSFADE_SECONDS, end));
      const direction = (i + slot) % 2 === 0 ? 1 : -1;
      photos.push({ stop: i, slot, alpha, zoom: 1.06 + 0.12 * p, panX: direction * (p - 0.5), panY: (p - 0.5) * 0.4, caption: clamp(span(t, start, start + 0.4)) * fadeOut });
    });
  });
  const covered = photos.reduce((most, photo) => Math.max(most, photo.alpha), 0);
  const cardAlpha = easeOut(span(t, plan.card[0], plan.card[0] + 0.45));
  const cardTime = t >= plan.card[1] ? CARD_BUILD_SECONDS : Math.max(0, ((t - plan.card[0]) * CARD_BUILD_SECONDS) / (plan.card[1] - plan.card[0]));
  return {
    intro: easeOut(span(t, 0.1, 0.7)) * (1 - easeInOut(span(t, INTRO_SECONDS - 0.4, INTRO_SECONDS))),
    map: (1 - covered) * (1 - easeInOut(span(t, plan.numbers[0], plan.numbers[0] + 0.4))),
    route: t >= plan.numbers[0] ? Infinity : route,
    focus,
    photos,
    numbers: easeOut(span(t, plan.numbers[0], plan.numbers[0] + 0.4)) * (1 - cardAlpha),
    count: easeOut(span(t, plan.numbers[0] + 0.2, plan.numbers[1] - 0.3)),
    cardAlpha,
    card: t >= plan.card[0] + CARD_BUILD_SECONDS || cardTime >= CARD_BUILD_SECONDS ? CARD_FINAL : cardTimeline(cardTime, Math.max(0, plan.stops.length - 1)),
  };
}
