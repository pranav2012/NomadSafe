import { requireOptionalNativeModule } from "expo-modules-core";

interface TextExtractorModule {
  isSupported: boolean;
  extractTextFromImage(path: string): Promise<string[]>;
}

/** On-device text recognition (ML Kit on Android, Apple Vision on iOS); nothing leaves the phone. */
const native = requireOptionalNativeModule<TextExtractorModule>("ExpoTextExtractor");

export const ocr = {
  /** False on builds without the native module (older dev clients) or unsupported devices. */
  isAvailable: native?.isSupported === true,
  /** Lines of text read from a local image. */
  async readLines(uri: string): Promise<string[]> {
    if (!native) throw new Error("Text recognition isn't in this build");
    const lines = await native.extractTextFromImage(uri.replace("file://", ""));
    return lines.flatMap((block) => block.split("\n")).map((line) => line.trim()).filter(Boolean);
  },
};
