import { BlurStyle, FilterMode, MipmapMode, PaintStyle, Skia, StrokeCap, TextAlign, TileMode, type SkCanvas, type SkImage, type SkParagraph, type SkTypefaceFontProvider } from "react-native-skia";
import { auraDark } from "@/constants/aura";
import type { VideoFrame } from "../utils/cardTimeline";
import { frameRoute, placeLabels, type Rect } from "../utils/recapMap";
import { drawMark, drawRecapCard, partial, radialGlow, text, withAlpha, type RecapCardContent } from "./recapCard";
import { AURORA, AURORA_STOPS, buildRecapGeometry, legDashes, type RecapGeometry } from "./recapGeometry";

export interface RecapVideoContent {
  card: RecapCardContent;
  kicker: string;
  headline: string;
  dates: string;
  /** Index-aligned with `card.stops`: the caption over that stop's photos. */
  stops: { name: string; detail: string }[];
  /** Big numbers shown before the pass. */
  numbers: { value: string; label: string; count?: number; kind?: "int" | "distance" }[];
  brand: string;
}

/** What's built once per video: the map, its labels and the decoded photos. */
export interface VideoScene {
  width: number;
  height: number;
  geometry: RecapGeometry;
  mapTop: number;
  labels: SkParagraph[];
  placed: (Rect | null)[];
  /** Per stop, in play order. */
  photos: (SkImage | null)[][];
}

const C = { bg: auraDark.bg, text: auraDark.text, soft: auraDark.textSoft, muted: auraDark.textMuted, accent: "#8B97FF" };
const MAX_PHOTO_EDGE = 1000;
const color = (value: string) => Skia.Color(value);

/** Decodes a kept photo once and keeps a raster copy no bigger than the video needs. */
export async function loadVideoPhoto(uri: string): Promise<SkImage | null> {
  try {
    const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (!image) return null;
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(image.width(), image.height()));
    const width = Math.max(1, Math.round(image.width() * scale));
    const height = Math.max(1, Math.round(image.height() * scale));
    const surface = Skia.Surface.Make(width, height);
    try {
      if (!surface) return null;
      surface
        .getCanvas()
        .drawImageRectOptions(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, width, height), FilterMode.Linear, MipmapMode.None);
      surface.flush();
      return surface.makeImageSnapshot();
    } finally {
      surface?.dispose();
      image.dispose();
    }
  } catch {
    return null;
  }
}

export function buildVideoScene(content: RecapVideoContent, fonts: SkTypefaceFontProvider, width: number, height: number, photos: (SkImage | null)[][]): VideoScene {
  const mapHeight = height * 0.62;
  const frame = frameRoute(content.card.stops, width, mapHeight, 90, content.card.region);
  const geometry = buildRecapGeometry(frame, content.card.stops, content.card.legs, content.card.countries);
  const labels = content.card.stops.map((stop) => text(fonts, stop.name.split(",")[0].trim(), { size: 24, color: C.text, weight: 600, width: 360, maxLines: 1 }));
  const last = geometry.points.length - 1;
  const placed = placeLabels(
    geometry.points.map((at, i) => ({ at, width: labels[i].getLongestLine(), height: labels[i].getHeight(), priority: i === 0 || i === last ? i : i + geometry.points.length })),
    { width, height: mapHeight },
    11,
  );
  return { width, height, geometry, mapTop: height * 0.2, labels, placed, photos };
}

function drawBackdrop(canvas: SkCanvas, width: number, height: number) {
  const bg = Skia.Paint();
  bg.setColor(color(C.bg));
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), bg);
  const area = { w: width, h: height };
  radialGlow(canvas, width * 0.18, height * 0.06, width * 0.75, width * 0.55, "rgba(34,199,184,0.30)", area);
  radialGlow(canvas, width * 0.85, height * 0.12, width * 0.8, width * 0.6, "rgba(91,108,255,0.38)", area);
  radialGlow(canvas, width * 0.6, height, width * 0.85, width * 0.65, "rgba(155,123,255,0.22)", area);
}

function drawMap(canvas: SkCanvas, scene: VideoScene, frame: VideoFrame) {
  const { geometry } = scene;
  canvas.save();
  canvas.translate(0, scene.mapTop);
  const land = Skia.Paint();
  land.setAntiAlias(true);
  const outline = Skia.Paint();
  outline.setAntiAlias(true);
  outline.setStyle(PaintStyle.Stroke);
  outline.setStrokeWidth(1.2);
  land.setColor(color("rgba(255,255,255,0.025)"));
  outline.setColor(color("rgba(255,255,255,0.10)"));
  canvas.drawPath(geometry.around, land);
  canvas.drawPath(geometry.around, outline);
  land.setColor(color("rgba(255,255,255,0.05)"));
  outline.setColor(color("rgba(255,255,255,0.24)"));
  canvas.drawPath(geometry.home, land);
  canvas.drawPath(geometry.home, outline);

  const [g0, g1] = geometry.gradient;
  const aurora = Skia.Shader.MakeLinearGradient(g0, g1, AURORA.map(color), AURORA_STOPS, TileMode.Clamp);
  geometry.legs.forEach((leg, i) => {
    if (frame.route <= i) return;
    const path = partial(leg.path, Math.min(1, frame.route - i));
    if (!path) return;
    const glow = Skia.Paint();
    glow.setAntiAlias(true);
    glow.setStyle(PaintStyle.Stroke);
    glow.setStrokeWidth(12);
    glow.setShader(aurora);
    glow.setAlphaf(0.45);
    glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, true));
    canvas.drawPath(path, glow);
    const line = Skia.Paint();
    line.setAntiAlias(true);
    line.setStyle(PaintStyle.Stroke);
    line.setStrokeWidth(4.5);
    line.setStrokeCap(StrokeCap.Round);
    line.setShader(aurora);
    const dashes = legDashes(leg.mode, 0.8);
    if (dashes) line.setPathEffect(Skia.PathEffect.MakeDash(dashes, 0));
    canvas.drawPath(path, line);
  });

  const dot = Skia.Paint();
  dot.setAntiAlias(true);
  dot.setColor(color(C.text));
  const halo = Skia.Paint();
  halo.setAntiAlias(true);
  halo.setColor(color("rgba(139,151,255,0.28)"));
  geometry.points.forEach((p, i) => {
    if (i > frame.focus || (i > 0 && frame.route < i - 0.05)) return;
    if (i === frame.focus) canvas.drawCircle(p.x, p.y, 22, halo);
    canvas.drawCircle(p.x, p.y, i === frame.focus ? 9 : 6, dot);
    const rect = scene.placed[i];
    if (rect) scene.labels[i].paint(canvas, rect.x, rect.y);
  });
  canvas.restore();
}

/** Draws `image` covering the frame, zoomed and panned (pan -1..1 of the spare room). */
function drawCover(canvas: SkCanvas, image: SkImage, width: number, height: number, zoom: number, panX: number, panY: number) {
  const scale = Math.max(width / image.width(), height / image.height()) * zoom;
  const w = image.width() * scale;
  const h = image.height() * scale;
  const x = (width - w) / 2 + panX * ((w - width) / 2);
  const y = (height - h) / 2 + panY * ((h - height) / 2);
  canvas.drawImageRectOptions(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(x, y, w, h), FilterMode.Linear, MipmapMode.None);
}

function drawPhotos(canvas: SkCanvas, scene: VideoScene, content: RecapVideoContent, frame: VideoFrame, fonts: SkTypefaceFontProvider) {
  const { width, height } = scene;
  for (const shot of frame.photos) {
    const image = scene.photos[shot.stop]?.[shot.slot];
    if (!image) continue;
    withAlpha(canvas, shot.alpha, () => {
      drawCover(canvas, image, width, height, shot.zoom, shot.panX, shot.panY);
      const shade = Skia.Paint();
      shade.setShader(
        Skia.Shader.MakeLinearGradient({ x: 0, y: height * 0.5 }, { x: 0, y: height }, [color("rgba(11,13,18,0)"), color("rgba(11,13,18,0.9)")], null, TileMode.Clamp),
      );
      canvas.drawRect(Skia.XYWHRect(0, height * 0.5, width, height * 0.5), shade);
      const caption = content.stops[shot.stop];
      if (!caption) return;
      withAlpha(canvas, shot.caption, () => {
        const name = text(fonts, caption.name, { size: 58, color: C.text, weight: 600, width: width - 96, maxLines: 1, spacing: -1.6 });
        name.paint(canvas, 48, height - 250);
        if (caption.detail) text(fonts, caption.detail, { size: 27, color: C.soft, weight: 500, width: width - 96, maxLines: 1 }).paint(canvas, 50, height - 250 + name.getHeight() + 4);
      });
    });
  }
}

function drawNumbers(canvas: SkCanvas, scene: VideoScene, content: RecapVideoContent, frame: VideoFrame, fonts: SkTypefaceFontProvider, formatDistance: (km: number) => string) {
  const rows = content.numbers.slice(0, 4);
  const rowHeight = 170;
  let y = (scene.height - rows.length * rowHeight) / 2;
  rows.forEach((row, i) => {
    const progress = Math.max(0, Math.min(1, frame.count * 1.4 - i * 0.12));
    const value =
      progress >= 1 || row.count === undefined ? row.value : row.kind === "distance" ? formatDistance(Math.max(1, row.count * progress)) : String(Math.round(row.count * progress));
    withAlpha(canvas, Math.min(1, progress * 3), () => {
      text(fonts, value, { size: 96, color: C.text, weight: 700, width: scene.width, align: TextAlign.Center, maxLines: 1, spacing: -4 }).paint(canvas, 0, y);
      text(fonts, row.label, { size: 26, color: C.muted, weight: 500, width: scene.width - 96, align: TextAlign.Center, maxLines: 1 }).paint(canvas, 48, y + 110);
    });
    y += rowHeight;
  });
}

/** One frame of the shared video: map and route, photos with captions, the numbers, then the pass. */
export function drawVideoFrame(
  canvas: SkCanvas,
  scene: VideoScene,
  content: RecapVideoContent,
  frame: VideoFrame,
  fonts: SkTypefaceFontProvider,
  formatDistance: (km: number) => string,
) {
  const { width, height } = scene;
  drawBackdrop(canvas, width, height);
  withAlpha(canvas, frame.map, () => drawMap(canvas, scene, frame));
  withAlpha(canvas, frame.intro, () => {
    text(fonts, content.kicker.toUpperCase(), { size: 22, color: C.soft, weight: 600, width: width - 96, maxLines: 1, spacing: 2 }).paint(canvas, 48, 150);
    const headline = text(fonts, content.headline, { size: 60, color: C.text, weight: 600, width: width - 96, maxLines: 2, spacing: -1.8 });
    headline.paint(canvas, 48, 190);
    text(fonts, content.dates, { size: 26, color: C.muted, width: width - 96, maxLines: 1 }).paint(canvas, 48, 200 + headline.getHeight());
  });
  drawPhotos(canvas, scene, content, frame, fonts);
  withAlpha(canvas, frame.numbers, () => drawNumbers(canvas, scene, content, frame, fonts, formatDistance));
  withAlpha(canvas, 1 - frame.cardAlpha, () => {
    drawMark(canvas, 40, 52, 46);
    text(fonts, content.brand, { size: 24, color: C.text, weight: 600, width: 300 }).paint(canvas, 92, 62);
  });
  withAlpha(canvas, frame.cardAlpha, () => drawRecapCard(canvas, width, content.card, fonts, frame.card, formatDistance));
}
