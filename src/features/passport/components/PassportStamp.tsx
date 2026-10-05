import React from "react";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from "react-native-svg";
import { auraFonts } from "@/constants/aura";
import { pick } from "../utils/passport";

export const STAMP_INKS = ["#8B97FF", "#22C7B8", "#B49CFF", "#FFB547", "#FF7A90", "#5B8CFF"];
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
}

function fontFor(title: string) {
  if (title.length <= 6) return 30;
  if (title.length <= 10) return 23;
  if (title.length <= 15) return 17;
  return 14;
}

/** A passport entry stamp: double-ruled shape, place on top, country in the middle, date below. */
export function PassportStamp({ seed, tiltSeed, title, top, bottom, viaApp, pending, width, pendingLabel }: Props) {
  const shape = SHAPES[pick(seed, SHAPES.length)];
  const ink = pending ? "rgba(237,239,245,0.45)" : STAMP_INKS[pick(seed, STAMP_INKS.length, 7)];
  const tilt = pick(tiltSeed, 15, 3) - 7;
  const dash = pending ? "5 6" : undefined;
  const outer = { stroke: ink, strokeWidth: 4, fill: "none", strokeDasharray: dash };
  const inner = { stroke: ink, strokeWidth: 1.6, fill: "none", opacity: 0.75, strokeDasharray: dash };
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
      <G rotation={tilt} origin={`${cx}, ${cy}`} opacity={pending ? 0.9 : 0.94}>
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

/** A domestic state seal, styled like a postmark rather than a border stamp. */
export function StateSeal({ title, bottom, visits, viaApp, width }: { title: string; bottom: string; visits: number; viaApp: boolean; width: number }) {
  const ink = "#22C7B8";
  const size = 120;
  const c = size / 2;
  const titleSize = title.length <= 8 ? 16 : title.length <= 14 ? 13 : 11;
  const waves = [0, 1, 2, 3].map((i) => `M${c + 30} ${36 + i * 14} q 8 -6 16 0 t 16 0 t 16 0`).join(" ");
  return (
    <Svg width={width} height={width} viewBox={`0 0 ${size + 30} ${size}`}>
      <G opacity={0.92}>
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
