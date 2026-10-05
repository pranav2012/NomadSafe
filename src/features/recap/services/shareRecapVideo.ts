import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { AlphaType, ColorType, Skia, type SkTypefaceFontProvider } from "react-native-skia";
import { logger } from "@/modules/logger";
import { drawRecapCard, type RecapCardContent } from "../components/recapCard";
import { clearOldCards } from "./shareRecapCard";
import { cardTimeline, VIDEO_FPS, VIDEO_SECONDS } from "../utils/cardTimeline";
import { videoEncoder } from "./videoEncoder";

const WIDTH = 720;
const HEIGHT = 1280;
const MAX_PENDING = 4;
const FILE_PREFIX = "nomadsafe-trip-";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type VideoResult = "shared" | "cancelled" | "failed";

/**
 * Renders the animated trip pass frame by frame (the same drawing as the image), encodes it to an
 * MP4 and opens the share sheet. `onProgress` gets 0..1; `isCancelled` is checked between frames.
 */
export async function shareRecapVideo(
  content: RecapCardContent,
  fonts: SkTypefaceFontProvider,
  options: { formatDistance: (km: number) => string; dialogTitle: string; onProgress: (progress: number) => void; isCancelled: () => boolean },
): Promise<VideoResult> {
  const encoder = videoEncoder;
  if (!encoder || !(await Sharing.isAvailableAsync())) return "failed";
  const surface = Skia.Surface.Make(WIDTH, HEIGHT);
  if (!surface) return "failed";
  const uri = `${FileSystem.cacheDirectory}${FILE_PREFIX}${Date.now()}.mp4`;
  const frames = VIDEO_SECONDS * VIDEO_FPS;
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
      drawRecapCard(canvas, WIDTH, content, fonts, cardTimeline(frame / VIDEO_FPS, content.legs.length), options.formatDistance);
      surface.flush();
      const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: WIDTH, height: HEIGHT, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Premul });
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
    const output = await encoder.finish();
    if (options.isCancelled()) return "cancelled";
    await Sharing.shareAsync(output, { mimeType: "video/mp4", UTI: "public.mpeg-4", dialogTitle: options.dialogTitle });
    return "shared";
  } catch (err) {
    logger.warn("trip-recap", "video failed", err);
    encoder.cancel();
    return "failed";
  }
}
