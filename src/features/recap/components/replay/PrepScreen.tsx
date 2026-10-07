import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";
import { AuraButton, Icon, PressableScale, type IconName } from "@/atoms";
import { auraFonts as f } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView } from "@/modules/analytics";
import { FlapBoard } from "../FlapBoard";
import { placeCode, type TripRecap } from "../../hooks/useTripRecap";
import type { PhotoCuration } from "../../hooks/usePhotoCuration";
import type { useTripWalking } from "../../hooks/useTripWalking";
import { ACCENT, c, rise, rs } from "./replayStyles";

function Row({
  icon,
  title,
  body,
  action,
  onPress,
  busy,
  done,
}: {
  icon: IconName;
  title: string;
  body: string;
  action: string | null;
  onPress: () => void;
  busy?: boolean;
  done?: boolean;
}) {
  return (
    <PressableScale onPress={onPress} disabled={busy || action === null} accessibilityRole="button" accessibilityHint={action ?? undefined} style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon name={done ? "check" : icon} size={20} color={done ? "#22C7B8" : ACCENT} />
      </View>
      <View style={rs.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      {busy ? <ActivityIndicator color={c.text} /> : action ? <Text style={styles.rowAction}>{action}</Text> : null}
    </PressableScale>
  );
}

/**
 * "Make it yours", before the replay plays: pick the trip's photos (the phone keeps the best per
 * stop) and connect steps, then play. Each opens an explanation before any system screen.
 */
export function PrepScreen({
  recap,
  curation,
  walking,
  onPickPhotos,
  onEditPhotos,
  onLinkSteps,
  onPlay,
  onClose,
}: {
  recap: TripRecap;
  curation: PhotoCuration;
  walking: ReturnType<typeof useTripWalking>;
  onPickPhotos: () => void;
  onEditPhotos: () => void;
  onLinkSteps: () => void;
  onPlay: (skipped: boolean) => void;
  onClose: () => void;
}) {
  const { t, formatCompactNumber } = useLocalization();
  const insets = useSafeAreaInsets();
  const { places } = recap;
  const codes = places.length > 1 ? [placeCode(places[0]), placeCode(places[places.length - 1])] : [placeCode(places[0] ?? "")];
  const photos = curation.photos;
  const busy = curation.busy;
  const steps = walking.totals ? Math.round(walking.totals.steps) : 0;
  const added = photos.length > 0 || steps > 0;

  const photosBody = busy
    ? busy.phase === "choosing"
      ? t("recap.choosingPhotos", { done: busy.done, total: busy.total })
      : t("recap.savingPhotos")
    : photos.length > 0
      ? t("recap.prepPhotosChosen", { count: photos.length })
      : t("recap.prepPhotosBody");
  const stepsBody = steps > 0 ? t("recap.prepStepsLinked", { count: steps, steps: formatCompactNumber(steps) }) : walking.linked ? t("recap.prepStepsNone") : t("recap.prepStepsBody", { source: walking.source === "apple_health" ? "Apple Health" : "Health Connect" });

  return (
    <View style={styles.root}>
      <LinearGradient colors={["rgba(91,108,255,0.32)", "rgba(34,199,184,0.10)", "rgba(11,13,18,0)"]} locations={[0, 0.35, 0.7]} style={StyleSheet.absoluteFill} />
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel={t("trip.close")} style={styles.round}>
          <Icon name="x" size={16} color={c.text} />
        </PressableScale>
      </View>
      <View style={styles.body}>
        <Text style={rs.kicker}>{t("recap.prepKicker")}</Text>
        <Text numberOfLines={3} style={[rs.headline, styles.headline]}>
          {recap.headline}
        </Text>
        <Text style={[rs.sub, rs.muted]}>{recap.dates}</Text>
        <View style={styles.hero}>
          {photos.length > 0 ? (
            <PrivateView style={styles.prints}>
              {photos.slice(0, 3).map((photo, i) => (
                <Animated.View key={photo.id} entering={rise(i * 90)} style={[styles.print, { transform: [{ rotate: `${(i - 1) * 6}deg` }], zIndex: i === 1 ? 2 : 1 }]}>
                  <Image source={{ uri: photo.uri }} style={styles.printImage} contentFit="cover" recyclingKey={photo.id} cachePolicy="memory" accessibilityIgnoresInvertColors />
                </Animated.View>
              ))}
            </PrivateView>
          ) : (
            <FlapBoard codes={codes} tile={36} gap={5} />
          )}
        </View>
        <View style={styles.rows}>
          <Row
            icon="camera"
            title={t("recap.prepPhotosTitle")}
            body={photosBody}
            action={photos.length > 0 ? t("recap.edit") : t("recap.pick")}
            onPress={photos.length > 0 ? onEditPhotos : onPickPhotos}
            busy={busy !== null}
            done={photos.length > 0}
          />
          {walking.available ? (
            <Row
              icon="footprints"
              title={t("recap.prepStepsTitle")}
              body={stepsBody}
              action={walking.linked ? null : t("recap.connect")}
              onPress={onLinkSteps}
              done={steps > 0}
            />
          ) : null}
        </View>
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <AuraButton label={t("recap.prepPlay")} icon="play" onPress={() => onPlay(false)} disabled={busy !== null} />
        {!added ? <AuraButton label={t("recap.prepSkip")} variant="ghost" size="md" onPress={() => onPlay(true)} disabled={busy !== null} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  top: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceStrong },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 12, gap: 8 },
  headline: { fontSize: 40, lineHeight: 45 },
  hero: { height: 170, alignItems: "center", justifyContent: "center", marginVertical: 8 },
  prints: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  print: { padding: 4, paddingBottom: 14, borderRadius: 6, backgroundColor: "#F4F2EE", marginHorizontal: -6 },
  printImage: { width: 88, height: 108, borderRadius: 3 },
  rows: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 22,
    backgroundColor: c.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.hairline,
  },
  rowIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceStrong },
  rowTitle: { fontFamily: f.semibold, fontSize: 17, color: c.text },
  rowBody: { fontFamily: f.regular, fontSize: 14, lineHeight: 19, color: c.textSoft, marginTop: 2 },
  rowAction: { fontFamily: f.semibold, fontSize: 15, color: ACCENT },
  footer: { paddingHorizontal: 20, gap: 6 },
});
