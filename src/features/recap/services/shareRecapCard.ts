import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { SkTypefaceFontProvider } from "react-native-skia";
import { logger } from "@/modules/logger";
import { encodeRecapCard, renderRecapCard, CARD_WIDTH, type RecapCardContent } from "../components/recapCard";

const FILE_PREFIX = "nomadsafe-trip-";

/** Renders the full-size card to a PNG in the cache and opens the share sheet. False when sharing isn't possible. */
export async function shareRecapCard(content: RecapCardContent, fonts: SkTypefaceFontProvider, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const image = renderRecapCard(content, fonts, CARD_WIDTH);
  if (!image) return false;
  const fileUri = `${FileSystem.cacheDirectory}${FILE_PREFIX}${Date.now()}.png`;
  try {
    await clearOldCards();
    await FileSystem.writeAsStringAsync(fileUri, encodeRecapCard(image), { encoding: FileSystem.EncodingType.Base64 });
    await Sharing.shareAsync(fileUri, { mimeType: "image/png", UTI: "public.png", dialogTitle });
    return true;
  } catch (err) {
    logger.warn("trip-recap", "share failed", err);
    return false;
  }
}

/** Deletes earlier shared cards and videos from the cache. */
export async function clearOldCards() {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(
    names.filter((name) => name.startsWith(FILE_PREFIX)).map((name) => FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true })),
  );
}
