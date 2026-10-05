import { requireOptionalNativeModule } from "expo-modules-core";

interface ExpoVideoEncoderModule {
  begin(path: string, width: number, height: number, fps: number): void;
  /** Copies the frame and queues it; returns how many frames are waiting to be encoded. */
  appendFrame(pixels: Uint8Array): number;
  pendingFrames(): number;
  /** Resolves the MP4's file URI. */
  finish(): Promise<string>;
  cancel(): void;
}

/** The native H.264 encoder (modules/expo-video-encoder); null on builds without it. */
export const videoEncoder = requireOptionalNativeModule<ExpoVideoEncoderModule>("ExpoVideoEncoder");
