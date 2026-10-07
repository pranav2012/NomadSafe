import React from "react";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Mask, Path, Polygon, Rect, Stop, Text as SvgText } from "react-native-svg";
import { auraFonts } from "@/constants/aura";
import { pick } from "../utils/passport";

export const STAMP_INKS = ["#8B97FF", "#22C7B8", "#B49CFF", "#FFB547", "#FF7A90", "#5B8CFF"];
// The same inks, deepened so they read on the light passport paper.
const PAPER_INKS = ["#3C4BD0", "#0B8479", "#6A4ACB", "#B8700C", "#C4385A", "#2A5DD0"];
const PAPER_PENDING = "rgba(29,34,48,0.42)";
const SHAPES = ["circle", "oval", "rect", "hexagon"] as const;
const VIEW_W = 160;
const VIEW_H = 130;

interface Props {
  /** Picks the shape and ink, so a country always looks the same. */
  seed: string;
  /** Varies the tilt between stamps of the same country. */
  tiltSeed: string;
  title: string;
  top: string | null;
  bottom: string;
  viaApp: boolean;
  pending: boolean;
  width: number;
  pendingLabel?: string;
  /** Inked on the light passport paper: deeper ink with uneven pressure, speckle and bleed. */
  paper?: boolean;
  /** Overrides the seeded tilt (e.g. 0 when the caller rotates the stamp itself). */
  tilt?: number;
}

function fontFor(title: string) {
  if (title.length <= 6) return 30;
  if (title.length <= 10) return 23;
  if (title.length <= 15) return 17;
  return 14;
}

/** A passport entry stamp: double-ruled shape, place on top, country in the middle, date below. */
export function PassportStamp({ seed, tiltSeed, title, top, bottom, viaApp, pending, width, pendingLabel, paper = false, tilt: tiltOverride }: Props) {
  const shape = SHAPES[pick(seed, SHAPES.length)];
  const inks = paper ? PAPER_INKS : STAMP_INKS;
  const ink = pending ? (paper ? PAPER_PENDING : "rgba(237,239,245,0.45)") : inks[pick(seed, inks.length, 7)];
  const tilt = tiltOverride ?? pick(tiltSeed, 15, 3) - 7;
  const maskId = `ink${pick(tiltSeed, 1e9, 11)}`;
  const dash = pending ? "5 6" : undefined;
  const outer = {
    stroke: ink,
    strokeWidth: 4,
    fill: "none",
    strokeDasharray: dash,
  };
  const inner = {
    stroke: ink,
    strokeWidth: 1.6,
    fill: "none",
    opacity: 0.75,
    strokeDasharray: dash,
  };
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const titleSize = fontFor(title);
  const height = (width * VIEW_H) / VIEW_W;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      <Defs>
        <LinearGradient id="seal" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor="#22C7B8" />
          <Stop offset="0.55" stopColor="#5B6CFF" />
          <Stop offset="1" stopColor="#9B7BFF" />
        </LinearGradient>
      </Defs>
      {paper ? (
        <Defs>
          <InkMask id={maskId} seed={tiltSeed} width={VIEW_W} height={VIEW_H} />
        </Defs>
      ) : null}
      <G mask={paper ? `url(#${maskId})` : undefined}>
        <G rotation={tilt} origin={`${cx}, ${cy}`} opacity={pending ? 0.9 : 0.94}>
          {paper ? <StampOutline shape={shape} {...outer} strokeWidth={8} opacity={0.12} /> : null}
          {shape === "circle" ? (
            <>
              <Circle cx={cx} cy={cy} r={60} {...outer} />
              <Circle cx={cx} cy={cy} r={53} {...inner} />
            </>
          ) : shape === "oval" ? (
            <>
              <Ellipse cx={cx} cy={cy} rx={76} ry={58} {...outer} />
              <Ellipse cx={cx} cy={cy} rx={69} ry={51} {...inner} />
            </>
          ) : shape === "rect" ? (
            <>
              <Rect x={6} y={10} width={148} height={110} rx={16} {...outer} />
              <Rect x={13} y={17} width={134} height={96} rx={11} {...inner} />
            </>
          ) : (
            <>
              <Polygon points="40,8 120,8 156,65 120,122 40,122 4,65" {...outer} />
              <Polygon points="44,15 116,15 148,65 116,115 44,115 12,65" {...inner} />
            </>
          )}
          {top ? (
            <SvgText x={cx} y={cy - titleSize * 0.85} fill={ink} fontSize={11} fontFamily={auraFonts.semibold} textAnchor="middle" letterSpacing={1}>
              {top.toUpperCase().slice(0, 18)}
            </SvgText>
          ) : null}
          <SvgText x={cx} y={cy + titleSize * 0.35} fill={ink} fontSize={titleSize} fontFamily={auraFonts.bold} textAnchor="middle" letterSpacing={-0.5}>
            {title}
          </SvgText>
          <Path d={`M${cx - 30} ${cy + titleSize * 0.35 + 8} H${cx + 30}`} stroke={ink} strokeWidth={1.2} opacity={0.6} />
          <SvgText x={cx} y={cy + titleSize * 0.35 + 24} fill={ink} fontSize={11.5} fontFamily={auraFonts.semibold} textAnchor="middle">
            {pending && pendingLabel ? pendingLabel : bottom}
          </SvgText>
        </G>
      </G>
      {viaApp && !pending ? (
        <G>
          <Circle cx={VIEW_W - 22} cy={VIEW_H - 20} r={14} fill="url(#seal)" />
          <Circle cx={VIEW_W - 22} cy={VIEW_H - 20} r={10.5} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
          <SvgText x={VIEW_W - 22} y={VIEW_H - 15.5} fill="#FFFFFF" fontSize={13} fontFamily={auraFonts.bold} textAnchor="middle">
            N
          </SvgText>
        </G>
      ) : null}
    </Svg>
  );
}

/** The outer rule of a stamp shape alone, for the soft ink bleed drawn under it. */
function StampOutline({ shape, ...props }: { shape: (typeof SHAPES)[number]; stroke: string; strokeWidth: number; fill: string; opacity: number; strokeDasharray?: string }) {
  if (shape === "circle") return <Circle cx={VIEW_W / 2} cy={VIEW_H / 2} r={60} {...props} />;
  if (shape === "oval") return <Ellipse cx={VIEW_W / 2} cy={VIEW_H / 2} rx={76} ry={58} {...props} />;
  if (shape === "rect") return <Rect x={6} y={10} width={148} height={110} rx={16} {...props} />;
  return <Polygon points="40,8 120,8 156,65 120,122 40,122 4,65" {...props} />;
}

function seededRandom(seed: string) {
  let h = pick(seed, 2147483647, 5) || 1;
  return () => {
    h = (h * 48271) % 2147483647;
    return h / 2147483647;
  };
}

/**
 * Uneven stamp pressure as a luminance mask: a gradient at a seeded angle fades one side of the
 * impression, and seeded specks knock tiny holes out of the ink.
 */
function InkMask({ id, seed, width, height }: { id: string; seed: string; width: number; height: number }) {
  const rand = seededRandom(seed);
  const angle = rand() * Math.PI * 2;
  const dx = Math.cos(angle) / 2;
  const dy = Math.sin(angle) / 2;
  const specks = Array.from({ length: 70 }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: 0.5 + rand() * 1.3,
    o: 0.55 + rand() * 0.45,
  }));
  return (
    <>
      <LinearGradient id={`${id}p`} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
        <Stop offset="0" stopColor="#FFFFFF" />
        <Stop offset="0.55" stopColor="#E6E6E6" />
        <Stop offset="1" stopColor="#8C8C8C" />
      </LinearGradient>
      <Mask id={id} x={0} y={0} width={width} height={height} maskUnits="userSpaceOnUse">
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id}p)`} />
        {specks.map((speck, i) => (
          <Circle key={i} cx={speck.x} cy={speck.y} r={speck.r} fill="#000000" opacity={speck.o} />
        ))}
      </Mask>
    </>
  );
}

/** A domestic state seal, styled like a postmark rather than a border stamp. */
export function StateSeal({
  title,
  bottom,
  visits,
  viaApp,
  width,
  paper = false,
  inkSeed = title,
}: {
  title: string;
  bottom: string;
  visits: number;
  viaApp: boolean;
  width: number;
  paper?: boolean;
  inkSeed?: string;
}) {
  const ink = paper ? "#0B8479" : "#22C7B8";
  const maskId = `seal${pick(inkSeed, 1e9, 13)}`;
  const size = 120;
  const c = size / 2;
  const titleSize = title.length <= 8 ? 16 : title.length <= 14 ? 13 : 11;
  const waves = [0, 1, 2, 3].map((i) => `M${c + 30} ${36 + i * 14} q 8 -6 16 0 t 16 0 t 16 0`).join(" ");
  return (
    <Svg width={width} height={width} viewBox={`0 0 ${size + 30} ${size}`}>
      {paper ? (
        <Defs>
          <InkMask id={maskId} seed={inkSeed} width={size + 30} height={size} />
        </Defs>
      ) : null}
      <G opacity={0.92} mask={paper ? `url(#${maskId})` : undefined}>
        {paper ? <Circle cx={c} cy={c} r={52} stroke={ink} strokeWidth={7} fill="none" opacity={0.12} /> : null}
        <Circle cx={c} cy={c} r={52} stroke={ink} strokeWidth={3} fill="none" />
        <Circle cx={c} cy={c} r={45} stroke={ink} strokeWidth={1.2} fill="none" strokeDasharray="2 4" />
        <Path d={waves} stroke={ink} strokeWidth={2.2} fill="none" strokeLinecap="round" opacity={0.75} />
        <SvgText x={c} y={c + 4} fill={ink} fontSize={titleSize} fontFamily={auraFonts.bold} textAnchor="middle">
          {title.length > 16 ? `${title.slice(0, 15)}…` : title}
        </SvgText>
        <SvgText x={c} y={c + 22} fill={ink} fontSize={10.5} fontFamily={auraFonts.semibold} textAnchor="middle">
          {visits > 1 ? `${bottom} · ×${visits}` : bottom}
        </SvgText>
      </G>
      {viaApp ? <Circle cx={c + 38} cy={c + 38} r={7} fill="#8B97FF" opacity={0.9} /> : null}
    </Svg>
  );
}
