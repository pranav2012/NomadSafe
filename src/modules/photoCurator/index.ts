import { requireOptionalNativeModule } from "expo-modules-core";

export interface PhotoAnalysis {
  labels: { label: string; confidence: number }[];
  /** Apple's aesthetics score, -1..1 (iOS 18+ only). */
  aesthetic: number | null;
  /** Apple's flag for screenshots, receipts and documents (iOS 18+ only). */
  utility: boolean | null;
  /** 0..1, from the variance of edges in a small copy. */
  sharpness: number | null;
  /** 0..1, how well exposed. */
  exposure: number | null;
  /** 0..1, how much of the picture is text (receipts, tickets, screenshots). */
  textCoverage: number | null;
}

interface PhotoCuratorModule {
  analyze(uris: string[]): Promise<Partial<PhotoAnalysis>[]>;
}

/** Local native module (modules/expo-photo-curator): Vision on iOS, ML Kit image labelling on Android. */
const native = requireOptionalNativeModule<PhotoCuratorModule>("ExpoPhotoCurator");

const EMPTY: PhotoAnalysis = { labels: [], aesthetic: null, utility: null, sharpness: null, exposure: null, textCoverage: null };

/** On-device photo labelling and quality scores for choosing a trip's best photos; nothing leaves the phone. */
export const photoCurator = {
  /** False on builds without the native module; curation then works from dates and places only. */
  isAvailable: native !== null,
  /** One result per uri, in order; an empty result where a photo couldn't be read. */
  async analyze(uris: string[]): Promise<PhotoAnalysis[]> {
    if (!native || uris.length === 0) return uris.map(() => EMPTY);
    const results = await native.analyze(uris);
    return uris.map((_, i) => ({ ...EMPTY, ...results[i], labels: results[i]?.labels ?? [] }));
  },
};
