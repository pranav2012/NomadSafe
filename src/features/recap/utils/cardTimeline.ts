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
export const VIDEO_SECONDS = 9;
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

/** The card's animation at `t` seconds into the video; from 8.2 s on it is the static card. */
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
