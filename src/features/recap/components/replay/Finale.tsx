import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { Easing, SensorType, useAnimatedSensor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useFonts } from "react-native-skia";
import { AuraButton, AuraSheet, AuraSwitch, Icon, PressableScale, showToast } from "@/atoms";
import { useGroupBalances } from "@/features/expenses/hooks/useGroupBalances";
import { AURA_FONT_FILES, auraFonts as f } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { CARD_HEIGHT, CARD_WIDTH, RECAP_FONT_FAMILY, encodeRecapCard, renderRecapCard } from "../recapCard";
import { afterSheet } from "../../hooks/useRecapExtras";
import type { TripRecap } from "../../hooks/useTripRecap";
import { shareRecapCard } from "../../services/shareRecapCard";
import { shareRecapVideo, type RecapVideoExtras } from "../../services/shareRecapVideo";
import { videoEncoder } from "../../services/videoEncoder";
import { c, rs } from "./replayStyles";

const PREVIEW_PIXELS = 900;

/** The card on screen, tilting with the phone so its foil catches the light; the shared image stays flat. */
function TiltCard({ width, height, uri, label }: { width: number; height: number; uri: string | null; label: string }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.set(withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [enter]);
  const tilt = useAnimatedStyle(() => {
    const g = gravity.sensor.get();
    const len = Math.hypot(g.x, g.y, g.z) || 1;
    const x = Math.max(-0.4, Math.min(0.4, g.x / len));
    const y = Math.max(-0.4, Math.min(0.4, g.y / len + 0.6));
    const e = enter.get();
    return {
      opacity: e,
      transform: [
        { perspective: 900 },
        { translateY: (1 - e) * 16 },
        { rotateY: `${x * 16}deg` },
        { rotateX: `${-y * 12}deg` },
        { rotateZ: "-1.2deg" },
      ],
    };
  });
  const sheen = useAnimatedStyle(() => {
    const g = gravity.sensor.get();
    const len = Math.hypot(g.x, g.y, g.z) || 1;
    return { transform: [{ translateX: (g.x / len) * width * 1.6 }] };
  });
  return (
    <Animated.View style={[styles.card, { width, height }, tilt]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} accessibilityLabel={label} /> : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sheen]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,150,220,0.10)", "rgba(140,210,255,0.16)", "rgba(160,255,210,0.10)", "rgba(255,255,255,0)"]}
          locations={[0.3, 0.42, 0.5, 0.58, 0.7]}
          start={{ x: 0, y: 0.2 }}
          end={{ x: 1, y: 0.8 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  );
}

/** The end of the replay: the trip pass with "Share your trip" (image or video, in a sheet) and what's next. */
export function Finale({
  recap,
  video,
  top,
  bottom,
  onPlanNext,
  onCheckBalances,
  onEditPhotos,
}: {
  recap: TripRecap;
  /** Photos, words and music for the shared video. */
  video: Omit<RecapVideoExtras, "card">;
  top: number;
  bottom: number;
  onPlanNext: () => void;
  onCheckBalances: () => void;
  onEditPhotos: () => void;
}) {
  const { t, formatDistance } = useLocalization();
  const { width, height } = useWindowDimensions();
  const fonts = useFonts({
    [RECAP_FONT_FAMILY]: [
      AURA_FONT_FILES.InstrumentSans_400Regular,
      AURA_FONT_FILES.InstrumentSans_500Medium,
      AURA_FONT_FILES.InstrumentSans_600SemiBold,
      AURA_FONT_FILES.InstrumentSans_700Bold,
    ],
  });
  const { transfers } = useGroupBalances(recap.trip);
  const [includeSpend, setIncludeSpend] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const cancelVideo = useRef(false);
  const contentKey = JSON.stringify(recap.cardContent(includeSpend));
  const preview = useMemo(() => {
    if (!fonts) return null;
    const image = renderRecapCard(JSON.parse(contentKey), fonts, PREVIEW_PIXELS);
    if (!image) return null;
    const uri = `data:image/png;base64,${encodeRecapCard(image)}`;
    image.dispose();
    return uri;
  }, [fonts, contentKey]);

  const cardHeight = Math.min(height * 0.44, (width - 96) * (CARD_HEIGHT / CARD_WIDTH));
  const cardWidth = (cardHeight * CARD_WIDTH) / CARD_HEIGHT;
  const photoCount = video.photos.reduce((sum, list) => sum + list.length, 0);
  const making = videoProgress !== null;
  const percent = Math.round((videoProgress ?? 0) * 100);

  // The system share sheet opens once ours is gone (iOS can't present over a closing modal).
  const closeSheetFirst = async () => {
    setSheetOpen(false);
    await afterSheet();
  };

  const share = async () => {
    if (!fonts || sharing) return;
    setSharing(true);
    track("recap_shared", { format: "image", spend: includeSpend && recap.spend !== null });
    await closeSheetFirst();
    const shared = await shareRecapCard(JSON.parse(contentKey), fonts, t("recap.shareDialogTitle"));
    setSharing(false);
    if (!shared) showToast(t("recap.shareFailed"));
  };

  const shareVideo = async () => {
    if (!fonts || making) return;
    cancelVideo.current = false;
    setVideoProgress(0);
    track("recap_shared", { format: "video", spend: includeSpend && recap.spend !== null });
    const result = await shareRecapVideo({ ...video, card: JSON.parse(contentKey) }, fonts, {
      formatDistance,
      dialogTitle: t("recap.shareDialogTitle"),
      onProgress: setVideoProgress,
      isCancelled: () => cancelVideo.current,
      beforeShare: closeSheetFirst,
    });
    setVideoProgress(null);
    if (result === "failed") showToast(t("recap.videoFailed"));
  };

  return (
    <View style={[styles.finale, { paddingTop: top, paddingBottom: bottom }]}>
      <View style={{ width: cardWidth }}>
        <TiltCard width={cardWidth} height={cardHeight} uri={preview} label={t("recap.previewLabel")} />
        <PressableScale onPress={onEditPhotos} accessibilityRole="button" style={styles.editChip}>
          <Icon name={photoCount > 0 ? "edit" : "camera"} size={13} color={c.text} />
          <Text style={styles.editText}>{photoCount > 0 ? t("recap.editPhotos") : t("recap.addPhotosChip")}</Text>
        </PressableScale>
      </View>
      <View style={styles.finaleText}>
        <Text style={styles.wrap}>{t("recap.finaleTitle")}</Text>
        <Text style={[rs.sub, styles.center]}>{t("recap.finaleBody")}</Text>
      </View>
      <View style={styles.actions}>
        <AuraButton
          label={making ? t("recap.makingVideo", { percent }) : t("recap.shareTrip")}
          icon="share"
          onPress={() => setSheetOpen(true)}
          loading={sharing}
          disabled={!fonts}
        />
        <View style={styles.links}>
          <PressableScale onPress={onPlanNext} accessibilityRole="button" haptic={false} style={styles.link}>
            <Text style={styles.linkText}>{t("recap.planNext")}</Text>
          </PressableScale>
          {transfers.length > 0 ? (
            <PressableScale onPress={onCheckBalances} accessibilityRole="button" haptic={false} style={styles.link}>
              <Text style={styles.linkText}>{t("recap.checkBalances")}</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>
      <AuraSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title={t("recap.shareTrip")}>
        <View style={styles.sheet}>
          {making ? (
            <View style={styles.making} accessibilityLiveRegion="polite">
              <Text style={styles.makingText}>{t("recap.makingVideo", { percent })}</Text>
              <View style={styles.makingTrack}>
                <View style={[styles.makingFill, { width: `${percent}%` }]} />
              </View>
              <AuraButton label={t("common.cancel")} variant="secondary" size="md" onPress={() => (cancelVideo.current = true)} />
            </View>
          ) : (
            <View style={styles.choices}>
              <PressableScale onPress={() => void share()} disabled={!fonts} accessibilityRole="button" style={styles.choice}>
                <Icon name="share" size={24} color={c.text} />
                <Text style={styles.choiceText}>{t("recap.storyImage")}</Text>
              </PressableScale>
              {videoEncoder ? (
                <PressableScale onPress={() => void shareVideo()} disabled={!fonts} accessibilityRole="button" style={styles.choice}>
                  <Icon name="play" size={24} color={c.text} />
                  <Text style={styles.choiceText}>{t("recap.videoChoice")}</Text>
                </PressableScale>
              ) : null}
            </View>
          )}
          {recap.spend && !making ? (
            <View style={styles.spendRow}>
              <Text style={[rs.sub, rs.flex]}>{t("recap.includeSpend")}</Text>
              <AuraSwitch value={includeSpend} onValueChange={setIncludeSpend} accessibilityLabel={t("recap.includeSpend")} />
            </View>
          ) : null}
        </View>
      </AuraSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  finale: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", paddingHorizontal: 20 },
  card: { borderRadius: 20, overflow: "hidden", backgroundColor: c.card, marginTop: 8 },
  // Just under the card's right edge, clear of the pass's own footer text.
  editChip: {
    alignSelf: "flex-end",
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "#2A2F3D",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.highlight,
  },
  editText: { fontFamily: f.semibold, fontSize: 13, color: c.text },
  finaleText: { marginTop: 8, alignItems: "center", gap: 2 },
  center: { textAlign: "center" },
  wrap: { fontFamily: f.semibold, fontSize: 28, letterSpacing: -0.8, color: c.text },
  actions: { alignSelf: "stretch", marginTop: "auto", gap: 6 },
  links: { flexDirection: "row", justifyContent: "center", gap: 8 },
  link: { paddingHorizontal: 14, paddingVertical: 12 },
  linkText: { fontFamily: f.medium, fontSize: 15, color: c.textSoft },
  sheet: { paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  choices: { flexDirection: "row", gap: 12 },
  choice: {
    flex: 1,
    height: 112,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: c.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.hairline,
  },
  choiceText: { fontFamily: f.semibold, fontSize: 16, color: c.text },
  spendRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  making: { alignItems: "stretch", gap: 12, paddingVertical: 8 },
  makingText: { fontFamily: f.semibold, fontSize: 16, color: c.text, textAlign: "center" },
  makingTrack: { height: 4, borderRadius: 2, backgroundColor: c.hairline, overflow: "hidden" },
  makingFill: { height: 4, borderRadius: 2, backgroundColor: c.text },
});
