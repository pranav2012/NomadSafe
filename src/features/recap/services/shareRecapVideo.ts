import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Asset } from "expo-asset";
import { AlphaType, ColorType, Skia, type SkImage, type SkTypefaceFontProvider } from "react-native-skia";
import { logger } from "@/modules/logger";
import { buildVideoScene, drawVideoFrame, loadVideoPhoto, type RecapVideoContent } from "../components/recapVideo";
import { clearOldCards } from "./shareRecapCard";
import { planVideo, videoFrameAt, VIDEO_FPS, VIDEO_PHOTOS_PER_STOP } from "../utils/cardTimeline";
import { videoEncoder } from "./videoEncoder";

const WIDTH = 720;
const HEIGHT = 1280;
const MAX_PENDING = 4;
const MUSIC_FADE_SECONDS = 2.5;
const FILE_PREFIX = "nomadsafe-trip-";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type VideoResult = "shared" | "cancelled" | "failed";

export interface RecapVideoExtras extends RecapVideoContent {
  /** Kept photo URIs per stop, best first. */
  photos: string[][];
  /** The bundled soundtrack (a `require`d asset); null for a silent video. */
  music: number | null;
}

/** The soundtrack as a local file the encoder can read; null when it can't be had. */
async function musicFile(music: number | null): Promise<string | null> {
  if (music === null) return null;
  try {
    const asset = await Asset.fromModule(music).downloadAsync();
    return asset.localUri ?? null;
  } catch (err) {
    logger.warn("trip-recap", "music unavailable for the video", err);
    return null;
  }
}

/**
 * Renders a ~15–20 s cut of the replay frame by frame (route, up to two photos per stop, the numbers,
 * then the trip pass), encodes it to an MP4 with the replay's music where the build supports it, and
 * opens the share sheet. `onProgress` gets 0..1; `isCancelled` is checked between frames.
 */
export async function shareRecapVideo(
  content: RecapVideoExtras,
  fonts: SkTypefaceFontProvider,
  options: {
    formatDistance: (km: number) => string;
    dialogTitle: string;
    onProgress: (progress: number) => void;
    isCancelled: () => boolean;
    /** Runs once the video is ready, before the system share sheet opens. */
    beforeShare?: () => Promise<void>;
  },
): Promise<VideoResult> {
  const encoder = videoEncoder;
  if (!encoder || !(await Sharing.isAvailableAsync())) return "failed";
  const surface = Skia.Surface.Make(WIDTH, HEIGHT);
  if (!surface) return "failed";
  const plan = planVideo(content.card.stops.map((_, i) => Math.min(VIDEO_PHOTOS_PER_STOP, content.photos[i]?.length ?? 0)));
  const images: (SkImage | null)[][] = [];
  for (let i = 0; i < plan.stops.length; i += 1) {
    const uris = (content.photos[i] ?? []).slice(0, plan.stops[i].photos.length);
    images.push(await Promise.all(uris.map(loadVideoPhoto)));
  }
  const scene = buildVideoScene(content, fonts, WIDTH, HEIGHT, images);
  const music = encoder.finishWithAudio ? await musicFile(content.music) : null;
  const uri = `${FileSystem.cacheDirectory}${FILE_PREFIX}${Date.now()}.mp4`;
  const frames = Math.ceil(plan.duration * VIDEO_FPS);
  const canvas = surface.getCanvas();
  try {
    await clearOldCards();
    encoder.begin(uri, WIDTH, HEIGHT, VIDEO_FPS);
    for (let frame = 0; frame < frames; frame += 1) {
      if (options.isCancelled()) {
        encoder.cancel();
        return "cancelled";
      }
      canvas.clear(Skia.Color("#000000"));
      drawVideoFrame(canvas, scene, content, videoFrameAt(plan, Math.min(plan.duration, frame / VIDEO_FPS)), fonts, options.formatDistance);
      surface.flush();
      // Each snapshot is a 3.7 MB copy; freed per frame rather than left to the GC.
      const snapshot = surface.makeImageSnapshot();
      const pixels = snapshot.readPixels(0, 0, { width: WIDTH, height: HEIGHT, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Premul });
      snapshot.dispose();
      if (!(pixels instanceof Uint8Array)) throw new Error("couldn't read frame pixels");
      let pending = encoder.appendFrame(pixels);
      // Let the encoder catch up, and give the UI a frame to show progress.
      while (pending > MAX_PENDING) {
        await pause(8);
        pending = encoder.pendingFrames();
      }
      options.onProgress((frame + 1) / frames);
      await pause(0);
    }
    const output = music && encoder.finishWithAudio ? await encoder.finishWithAudio(music, MUSIC_FADE_SECONDS) : await encoder.finish();
    if (options.isCancelled()) return "cancelled";
    await options.beforeShare?.();
    await Sharing.shareAsync(output, { mimeType: "video/mp4", UTI: "public.mpeg-4", dialogTitle: options.dialogTitle });
    return "shared";
  } catch (err) {
    logger.warn("trip-recap", "video failed", err);
    encoder.cancel();
    return "failed";
  } finally {
    for (const list of images) for (const image of list) image?.dispose?.();
    surface.dispose();
  }
}
