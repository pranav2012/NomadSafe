import {
  BlendMode,
  BlurStyle,
  ClipOp,
  ImageFormat,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TextAlign,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkParagraph,
  type SkTypefaceFontProvider,
} from "react-native-skia";
import { auraDark } from "@/constants/aura";
import type { GeoBox } from "../utils/countryShapes";
import { frameRoute, placeLabels, type Point } from "../utils/recapMap";
import type { RecapLeg, RecapMode, RecapStop } from "../utils/recapFacts";
import { AURORA, AURORA_STOPS, buildRecapGeometry, legDashes } from "./recapGeometry";

export const RECAP_FONT_FAMILY = "RecapCard";
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

export interface RecapCardContent {
  /** Departure-board codes, e.g. ["TOK", "OSA"]; one code for a single-stop trip. */
  codes: string[];
  title: string;
  via: string | null;
  stops: RecapStop[];
  legs: RecapLeg[];
  countries: string[];
  /** Framing for a single-stop trip: the stop's country. */
  region: GeoBox | null;
  stamp: { title: string; detail: string } | null;
  legend: { mode: RecapMode; label: string }[];
  stats: { value: string; label: string }[];
  footer: string;
  dates: string;
  promo: string;
  brand: string;
}

const C = {
  bg: auraDark.bg,
  text: auraDark.text,
  soft: auraDark.textSoft,
  muted: auraDark.textMuted,
  highlight: "rgba(255,255,255,0.16)",
  accent: "#8B97FF",
};
const TICKET = { x: 80, y: 200, w: 920, h: 1560, r: 40, tilt: -1.2 };
const PAD = 64;
const INNER = TICKET.w - PAD * 2;
const MAP = { x: PAD, y: 400, w: INNER, h: 680 };
const PERF_Y = 1124;
const N_PATH = Skia.Path.MakeFromSVGString("M184 340 V172 L328 340 V172")!;
const ARC_PATH = Skia.Path.MakeFromSVGString("M92 380 C170 430 342 430 420 380")!;
const PLANE_PATH = Skia.Path.MakeFromSVGString("M10.5 20l1.5-6-6 2.5V14l6-4.5V4.5a1.5 1.5 0 013 0v5L21 14v2.5L15 14l1.5 6-3-1.2-3 1.2z")!;

const color = (value: string) => Skia.Color(value);

function text(
  fonts: SkTypefaceFontProvider,
  value: string,
  opts: { size: number; color: string; weight?: 400 | 500 | 600 | 700; width: number; align?: TextAlign; maxLines?: number; spacing?: number; lineHeight?: number },
): SkParagraph {
  const builder = Skia.ParagraphBuilder.Make({ textAlign: opts.align ?? TextAlign.Left, maxLines: opts.maxLines, ellipsis: "…" }, fonts);
  builder.pushStyle({
    color: color(opts.color),
    fontFamilies: [RECAP_FONT_FAMILY],
    fontSize: opts.size,
    fontStyle: { weight: opts.weight ?? 400 },
    letterSpacing: opts.spacing ?? 0,
    heightMultiplier: opts.lineHeight,
  });
  builder.addText(value);
  const paragraph = builder.build();
  paragraph.layout(opts.width);
  return paragraph;
}

/** Largest size up to `size` at which `value` fits on one line in `width`. */
function fittedText(fonts: SkTypefaceFontProvider, value: string, size: number, width: number, opts: { color: string; weight: 600 | 700; spacing: number }) {
  let current = size;
  let paragraph = text(fonts, value, { ...opts, size: current, width: 10_000 });
  while (paragraph.getLongestLine() > width && current > size * 0.45) {
    current -= 4;
    paragraph = text(fonts, value, { ...opts, size: current, spacing: (opts.spacing * current) / size, width: 10_000 });
  }
  return paragraph;
}

function radialGlow(canvas: SkCanvas, cx: number, cy: number, rx: number, ry: number, rgba: string, area: { w: number; h: number }) {
  const paint = Skia.Paint();
  const matrix = Skia.Matrix();
  matrix.translate(cx, cy);
  matrix.scale(1, ry / rx);
  matrix.translate(-cx, -cy);
  paint.setShader(Skia.Shader.MakeRadialGradient({ x: cx, y: cy }, rx, [color(rgba), color("rgba(0,0,0,0)")], null, TileMode.Clamp, matrix));
  canvas.drawRect(Skia.XYWHRect(0, 0, area.w, area.h), paint);
}

/** The NomadSafe mark (aurora N with its dashed arc), `size` px square at x, y. */
export function drawMark(canvas: SkCanvas, x: number, y: number, size: number) {
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(size / 512, size / 512);
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeWidth(46);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  stroke.setShader(Skia.Shader.MakeLinearGradient({ x: 96, y: 420 }, { x: 416, y: 92 }, AURORA.map(color), AURORA_STOPS, TileMode.Clamp));
  const glow = stroke.copy();
  glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 18, true));
  glow.setAlphaf(0.75);
  canvas.drawPath(N_PATH, glow);
  canvas.drawPath(N_PATH, stroke);
  const arc = Skia.Paint();
  arc.setAntiAlias(true);
  arc.setStyle(PaintStyle.Stroke);
  arc.setStrokeWidth(6);
  arc.setStrokeCap(StrokeCap.Round);
  arc.setColor(color(C.text));
  arc.setAlphaf(0.55);
  arc.setPathEffect(Skia.PathEffect.MakeDash([2, 14], 0));
  canvas.drawPath(ARC_PATH, arc);
  canvas.restore();
}

function drawPlane(canvas: SkCanvas, cx: number, cy: number, size: number, rgba: string) {
  canvas.save();
  canvas.translate(cx - size / 2, cy - size / 2);
  canvas.scale(size / 24, size / 24);
  canvas.rotate(90, 12, 12);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(2.3);
  paint.setStrokeJoin(StrokeJoin.Round);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setColor(color(rgba));
  canvas.drawPath(PLANE_PATH, paint);
  canvas.restore();
}

/** Departure-board tiles; `plane` puts the aurora plane tile between the first and last code. */
export function drawFlaps(canvas: SkCanvas, fonts: SkTypefaceFontProvider, codes: string[], x: number, y: number, tile: { w: number; h: number; gap: number }) {
  const cells: (string | null)[] = codes.length > 1 ? [...codes[0].split(""), null, ...codes[codes.length - 1].split("")] : codes[0]?.split("") ?? [];
  const radius = tile.w * 0.115;
  cells.forEach((cell, i) => {
    const left = x + i * (tile.w + tile.gap);
    const rect = Skia.RRectXY(Skia.XYWHRect(left, y, tile.w, tile.h), radius, radius);
    const fill = Skia.Paint();
    fill.setAntiAlias(true);
    fill.setShader(
      cell === null
        ? Skia.Shader.MakeLinearGradient({ x: left, y }, { x: left + tile.w, y: y + tile.h }, AURORA.map(color), AURORA_STOPS, TileMode.Clamp)
        : Skia.Shader.MakeLinearGradient({ x: left, y }, { x: left, y: y + tile.h }, [color("#1C202B"), color("#12151D")], null, TileMode.Clamp),
    );
    canvas.drawRRect(rect, fill);
    if (cell === null) {
      drawPlane(canvas, left + tile.w / 2, y + tile.h / 2, tile.w * 0.62, "#FFFFFF");
      return;
    }
    const edge = Skia.Paint();
    edge.setAntiAlias(true);
    edge.setStyle(PaintStyle.Stroke);
    edge.setStrokeWidth(1.5);
    edge.setColor(color(C.highlight));
    canvas.drawRRect(rect, edge);
    const letter = text(fonts, cell, { size: tile.w, color: C.text, weight: 600, width: tile.w, align: TextAlign.Center, spacing: -1 });
    letter.paint(canvas, left, y + (tile.h - letter.getHeight()) / 2 + tile.h * 0.01);
    const seam = Skia.Paint();
    seam.setColor(color("rgba(0,0,0,0.55)"));
    canvas.drawRect(Skia.XYWHRect(left, y + tile.h / 2 - 1, tile.w, 2), seam);
  });
}

function drawMap(canvas: SkCanvas, fonts: SkTypefaceFontProvider, content: RecapCardContent) {
  const frame = frameRoute(content.stops, MAP.w, MAP.h, 70, content.region);
  const geometry = buildRecapGeometry(frame, content.stops, content.legs, content.countries);
  canvas.save();
  canvas.translate(MAP.x, MAP.y);

  // Countries fade out towards the map's edges instead of being cut off: the paint itself carries the fade.
  const faded = (rgba: [number, number, number, number]) =>
    Skia.Shader.MakeRadialGradient(
      { x: MAP.w / 2, y: MAP.h / 2 },
      MAP.w / 2,
      [rgba, rgba, [rgba[0], rgba[1], rgba[2], 0]].map(([r, g, b, a]) => color(`rgba(${r},${g},${b},${a})`)),
      [0, 0.5, 0.86],
      TileMode.Clamp,
    );
  const land = Skia.Paint();
  land.setAntiAlias(true);
  const outline = Skia.Paint();
  outline.setAntiAlias(true);
  outline.setStyle(PaintStyle.Stroke);
  outline.setStrokeJoin(StrokeJoin.Round);
  outline.setStrokeWidth(1.4);
  land.setShader(faded([255, 255, 255, 0.025]));
  outline.setShader(faded([255, 255, 255, 0.11]));
  canvas.drawPath(geometry.around, land);
  canvas.drawPath(geometry.around, outline);
  land.setShader(faded([255, 255, 255, 0.045]));
  outline.setShader(faded([255, 255, 255, 0.22]));
  canvas.drawPath(geometry.home, land);
  canvas.drawPath(geometry.home, outline);

  const [g0, g1] = geometry.gradient;
  const aurora = Skia.Shader.MakeLinearGradient(g0, g1, AURORA.map(color), AURORA_STOPS, TileMode.Clamp);
  for (const leg of geometry.legs) {
    const glow = Skia.Paint();
    glow.setAntiAlias(true);
    glow.setStyle(PaintStyle.Stroke);
    glow.setStrokeWidth(16);
    glow.setShader(aurora);
    glow.setAlphaf(0.45);
    glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 7, true));
    canvas.drawPath(leg.path, glow);
    const line = Skia.Paint();
    line.setAntiAlias(true);
    line.setStyle(PaintStyle.Stroke);
    line.setStrokeWidth(6);
    line.setStrokeCap(StrokeCap.Round);
    line.setShader(aurora);
    const dashes = legDashes(leg.mode);
    if (dashes) line.setPathEffect(Skia.PathEffect.MakeDash(dashes, 0));
    canvas.drawPath(leg.path, line);
  }

  const dot = Skia.Paint();
  dot.setAntiAlias(true);
  dot.setColor(color(C.text));
  const last = geometry.points.length - 1;
  geometry.points.forEach((p, i) => canvas.drawCircle(p.x, p.y, i === 0 || i === last ? 13 : 8, dot));

  const labels = content.stops.map((stop) => text(fonts, stop.name.split(",")[0].trim(), { size: 27, color: C.text, weight: 600, width: 400, maxLines: 1 }));
  const placed = placeLabels(
    geometry.points.map((at, i) => ({
      at,
      width: labels[i].getLongestLine(),
      height: labels[i].getHeight(),
      priority: i === 0 || i === last ? i : i + geometry.points.length,
    })),
    { width: MAP.w, height: MAP.h },
    13,
  );
  placed.forEach((rect, i) => rect && labels[i].paint(canvas, rect.x, rect.y));

  if (content.stamp) drawStamp(canvas, fonts, content.stamp, stampSpot(geometry.points, placed));
  canvas.restore();
}

/** The map corner with the fewest stops and labels in it, so the stamp covers as little as possible. */
function stampSpot(points: Point[], labels: ({ x: number; y: number; width: number; height: number } | null)[]): Point {
  const corners: Point[] = [
    { x: 10, y: 50 },
    { x: MAP.w - 330, y: 50 },
    { x: 10, y: MAP.h - 250 },
    { x: MAP.w - 330, y: MAP.h - 250 },
  ];
  const busy = (corner: Point) => {
    const inside = (x: number, y: number) => x > corner.x - 20 && x < corner.x + 340 && y > corner.y - 20 && y < corner.y + 230;
    return (
      points.filter((p) => inside(p.x, p.y)).length * 3 +
      labels.filter((r) => r && (inside(r.x, r.y) || inside(r.x + r.width, r.y + r.height))).length
    );
  };
  return corners.reduce((best, corner) => (busy(corner) < busy(best) ? corner : best), corners[0]);
}

function drawStamp(canvas: SkCanvas, fonts: SkTypefaceFontProvider, stamp: { title: string; detail: string }, at: Point) {
  canvas.save();
  canvas.translate(at.x, at.y);
  canvas.rotate(-8, 160, 105);
  const outer = Skia.Paint();
  outer.setAntiAlias(true);
  outer.setStyle(PaintStyle.Stroke);
  outer.setStrokeWidth(5);
  outer.setColor(color("rgba(139,151,255,0.85)"));
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, 320, 210), 26, 26), outer);
  const inner = outer.copy();
  inner.setStrokeWidth(2);
  inner.setColor(color("rgba(139,151,255,0.55)"));
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(9, 9, 302, 192), 18, 18), inner);
  const title = fittedText(fonts, stamp.title, 84, 260, { color: C.accent, weight: 700, spacing: -2 });
  const detail = text(fonts, stamp.detail, { size: 23, color: C.soft, weight: 600, width: 270, maxLines: 1 });
  const top = (210 - title.getHeight() - 8 - detail.getHeight()) / 2;
  title.paint(canvas, 30, top);
  detail.paint(canvas, 32, top + title.getHeight() + 8);
  canvas.restore();
}

function drawLegend(canvas: SkCanvas, fonts: SkTypefaceFontProvider, legend: RecapCardContent["legend"], y: number) {
  let x = PAD;
  for (const item of legend) {
    const line = Skia.Paint();
    line.setAntiAlias(true);
    line.setStyle(PaintStyle.Stroke);
    line.setStrokeWidth(5);
    line.setStrokeCap(StrokeCap.Round);
    line.setColor(color(C.accent));
    const dashes = legDashes(item.mode === "other" ? null : item.mode, 0.7);
    if (dashes) line.setPathEffect(Skia.PathEffect.MakeDash(dashes, 0));
    canvas.drawLine(x, y + 16, x + 46, y + 16, line);
    const label = text(fonts, item.label, { size: 25, color: C.muted, width: 320, maxLines: 1 });
    label.paint(canvas, x + 58, y);
    x += 58 + label.getLongestLine() + 40;
  }
}

/** Paints the 1080×1920 share card, scaled to `width`. */
export function drawRecapCard(canvas: SkCanvas, width: number, content: RecapCardContent, fonts: SkTypefaceFontProvider) {
  canvas.save();
  canvas.scale(width / CARD_WIDTH, width / CARD_WIDTH);
  const area = { w: CARD_WIDTH, h: CARD_HEIGHT };

  const bg = Skia.Paint();
  bg.setColor(color(C.bg));
  canvas.drawRect(Skia.XYWHRect(0, 0, area.w, area.h), bg);
  radialGlow(canvas, 194, 115, 760, 520, "rgba(34,199,184,0.30)", area);
  radialGlow(canvas, 918, 230, 820, 600, "rgba(91,108,255,0.38)", area);
  radialGlow(canvas, 648, 1920, 900, 700, "rgba(155,123,255,0.22)", area);

  drawMark(canvas, 72, 64, 76);
  text(fonts, content.brand, { size: 34, color: C.text, weight: 600, width: 600, spacing: -0.4 }).paint(canvas, 158, 79);

  canvas.save();
  canvas.rotate(TICKET.tilt, TICKET.x + TICKET.w / 2, TICKET.y + TICKET.h / 2);
  canvas.translate(TICKET.x, TICKET.y);
  const shape = Skia.RRectXY(Skia.XYWHRect(0, 0, TICKET.w, TICKET.h), TICKET.r, TICKET.r);
  const shadow = Skia.Paint();
  shadow.setColor(color("rgba(0,0,0,0.6)"));
  shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 50, true));
  canvas.save();
  canvas.translate(0, 50);
  canvas.drawRRect(shape, shadow);
  canvas.restore();

  canvas.save();
  canvas.clipRRect(shape, ClipOp.Intersect, true);
  const body = Skia.Paint();
  body.setShader(
    Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: TICKET.w * 0.6, y: TICKET.h }, [color("#1A1E29"), color(auraDark.card), color("#0F1219")], [0, 0.45, 1], TileMode.Clamp),
  );
  canvas.drawRect(Skia.XYWHRect(0, 0, TICKET.w, TICKET.h), body);
  const ticketArea = { w: TICKET.w, h: TICKET.h };
  radialGlow(canvas, 55, 62, 520, 420, "rgba(91,108,255,0.40)", ticketArea);
  radialGlow(canvas, TICKET.w, 405, 520, 460, "rgba(155,123,255,0.28)", ticketArea);
  radialGlow(canvas, TICKET.w / 2, TICKET.h, 600, 420, "rgba(34,199,184,0.24)", ticketArea);
  const foil = Skia.Paint();
  foil.setBlendMode(BlendMode.Screen);
  foil.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: TICKET.w, y: TICKET.h * 0.7 },
      ["rgba(0,0,0,0)", "rgba(255,120,200,0.06)", "rgba(120,200,255,0.07)", "rgba(140,255,200,0.05)", "rgba(0,0,0,0)"].map(color),
      [0.22, 0.34, 0.44, 0.54, 0.66],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(Skia.XYWHRect(0, 0, TICKET.w, TICKET.h), foil);

  drawFlaps(canvas, fonts, content.codes, PAD, 64, { w: 104, h: 148, gap: 8 });
  text(fonts, content.title, { size: 50, color: C.text, weight: 600, width: INNER, maxLines: 1, spacing: -1.4 }).paint(canvas, PAD, 248);
  if (content.via) text(fonts, content.via, { size: 29, color: C.soft, width: 760, maxLines: 2, lineHeight: 1.35 }).paint(canvas, PAD, 316);

  drawMap(canvas, fonts, content);
  if (content.legend.length > 0) drawLegend(canvas, fonts, content.legend, 1060);

  const perf = Skia.Paint();
  perf.setAntiAlias(true);
  perf.setStyle(PaintStyle.Stroke);
  perf.setStrokeWidth(3);
  perf.setColor(color(C.highlight));
  perf.setPathEffect(Skia.PathEffect.MakeDash([9, 9], 0));
  canvas.drawLine(50, PERF_Y, TICKET.w - 50, PERF_Y, perf);
  const notch = Skia.Paint();
  notch.setAntiAlias(true);
  notch.setColor(color(C.bg));
  const notchEdge = Skia.Paint();
  notchEdge.setAntiAlias(true);
  notchEdge.setStyle(PaintStyle.Stroke);
  notchEdge.setStrokeWidth(1.5);
  notchEdge.setColor(color(C.highlight));
  for (const nx of [0, TICKET.w]) {
    canvas.drawCircle(nx, PERF_Y, 34, notch);
    canvas.drawCircle(nx, PERF_Y, 34, notchEdge);
  }

  const columns = [0.9, 1.75, 0.75];
  const unit = INNER / columns.reduce((sum, c) => sum + c, 0);
  // Values share a baseline even when one shrinks to fit its column, and the labels share a line.
  const stats = content.stats.slice(0, 3).map((stat, i) => {
    const cell = columns[i] * unit;
    return { cell, value: fittedText(fonts, stat.value, 120, cell - 24, { color: C.text, weight: 700, spacing: -5 }), label: stat.label };
  });
  const baselineOf = (p: SkParagraph) => p.getLineMetrics()[0]?.baseline ?? p.getHeight();
  const baseline = Math.max(...stats.map((stat) => baselineOf(stat.value)));
  const valueBottom = Math.max(...stats.map((stat) => stat.value.getHeight() - baselineOf(stat.value))) + baseline;
  let x = PAD;
  for (const stat of stats) {
    stat.value.paint(canvas, x, 1172 + baseline - baselineOf(stat.value));
    text(fonts, stat.label, { size: 27, color: C.muted, width: stat.cell - 16, maxLines: 2 }).paint(canvas, x, 1172 + valueBottom + 6);
    x += stat.cell;
  }

  drawMark(canvas, PAD - 8, 1420, 52);
  text(fonts, content.footer, { size: 26, color: C.text, weight: 600, width: 520, maxLines: 1 }).paint(canvas, PAD + 50, 1432);
  text(fonts, content.dates, { size: 26, color: C.muted, width: 320, align: TextAlign.Right, maxLines: 1 }).paint(canvas, TICKET.w - PAD - 320, 1432);
  canvas.restore();

  const edge = Skia.Paint();
  edge.setAntiAlias(true);
  edge.setStyle(PaintStyle.Stroke);
  edge.setStrokeWidth(1.5);
  edge.setColor(color(C.highlight));
  canvas.drawRRect(shape, edge);
  canvas.restore();

  text(fonts, content.promo, { size: 28, color: C.soft, weight: 500, width: CARD_WIDTH, align: TextAlign.Center, maxLines: 1 }).paint(canvas, 0, CARD_HEIGHT - 100);
  canvas.restore();
}

/** Renders the card on a CPU raster surface, so it never adds a second GPU canvas. */
export function renderRecapCard(content: RecapCardContent, fonts: SkTypefaceFontProvider, width: number): SkImage | null {
  const height = Math.round((width * CARD_HEIGHT) / CARD_WIDTH);
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;
  drawRecapCard(surface.getCanvas(), width, content, fonts);
  surface.flush();
  return surface.makeImageSnapshot();
}

export function encodeRecapCard(image: SkImage): string {
  return image.encodeToBase64(ImageFormat.PNG);
}
