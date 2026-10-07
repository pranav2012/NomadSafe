import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { AuraButton, AuraSheet, PressableScale, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { PrivateView } from "@/modules/analytics";
import { shortPlace, type TripRecap } from "../../hooks/useTripRecap";
import type { PhotoCuration } from "../../hooks/usePhotoCuration";
import type { TripPhoto } from "../../store/tripPhotosStore";
import { photosByStop } from "../../utils/photoCuration";

const THUMB = 92;

/**
 * The photos in the replay, by stop. Tap one to remove it or swap it for another of this session's
 * picks; "Pick more" goes back to the picker.
 */
export function PhotoEditorSheet({
  visible,
  onClose,
  recap,
  curation,
  onPickMore,
}: {
  visible: boolean;
  onClose: () => void;
  recap: TripRecap;
  curation: PhotoCuration;
  onPickMore: () => void;
}) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [selected, setSelected] = useState<string | null>(null);
  const byStop = photosByStop(curation.photos, recap.facts.stops, recap.schedule, Infinity);
  const placed = new Set(byStop.flat().map((photo) => photo.id));
  const unplaced = curation.photos.filter((photo) => !placed.has(photo.id));
  const sections = [
    ...byStop.map((photos, stop) => ({ key: `stop-${stop}`, stop: stop as number | null, title: shortPlace(recap.facts.stops[stop].name), photos })),
    ...(unplaced.length > 0 ? [{ key: "unplaced", stop: null, title: t("recap.editorUnplaced"), photos: unplaced }] : []),
  ].filter((section) => section.photos.length > 0);

  const renderActions = (photo: TripPhoto, stop: number | null) => {
    const spares = curation.sparesFor(stop).slice(0, 12);
    return (
      <View style={styles.actions}>
        {spares.length > 0 ? (
          <>
            <Text style={[styles.hint, { color: c.textSoft, fontFamily: f.medium }]}>{t("recap.swapWith")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {spares.map((spare) => (
                <PressableScale
                  key={spare.photo.id}
                  onPress={() => {
                    setSelected(null);
                    void curation.swap(photo, spare);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("recap.swapPhoto")}
                >
                  <Image source={{ uri: spare.photo.uri }} style={styles.spare} contentFit="cover" recyclingKey={spare.photo.id} cachePolicy="memory" accessibilityIgnoresInvertColors />
                </PressableScale>
              ))}
            </ScrollView>
          </>
        ) : (
          <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("recap.noSpares")}</Text>
        )}
        <AuraButton
          label={t("recap.removePhoto")}
          icon="trash"
          variant="secondary"
          size="md"
          onPress={() => {
            setSelected(null);
            void curation.remove(photo);
          }}
        />
      </View>
    );
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={t("recap.editorTitle")}
      subtitle={t("recap.editorSubtitle")}
      full
      footer={<AuraButton label={t("recap.pickMorePhotos")} icon="camera" onPress={onPickMore} disabled={curation.busy !== null} />}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {sections.length === 0 ? <Text style={[styles.empty, { color: c.textSoft, fontFamily: f.regular }]}>{t("recap.editorEmpty")}</Text> : null}
        <PrivateView>
          {sections.map((section) => {
            const chosen = section.photos.find((photo) => photo.id === selected);
            return (
              <View key={section.key} style={styles.section}>
                <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{section.title}</Text>
                <View style={styles.grid}>
                  {section.photos.map((photo, i) => (
                    <PressableScale
                      key={photo.id}
                      onPress={() => setSelected((current) => (current === photo.id ? null : photo.id))}
                      accessibilityRole="button"
                      accessibilityState={{ selected: photo.id === selected }}
                      accessibilityLabel={t("recap.photoLabel", { n: i + 1, place: section.title })}
                    >
                      <Image
                        source={{ uri: photo.uri }}
                        style={[styles.thumb, { borderColor: photo.id === selected ? c.text : "transparent" }]}
                        contentFit="cover"
                        recyclingKey={photo.id}
                        cachePolicy="memory"
                        accessibilityIgnoresInvertColors
                      />
                    </PressableScale>
                  ))}
                </View>
                {chosen ? renderActions(chosen, section.stop) : null}
              </View>
            );
          })}
        </PrivateView>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 16, gap: 18 },
  empty: { fontSize: 15, lineHeight: 21, paddingVertical: 12 },
  section: { gap: 10, marginBottom: 18 },
  title: { fontSize: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 14, borderWidth: 2 },
  actions: { gap: 10 },
  hint: { fontSize: 13.5 },
  strip: { gap: 8 },
  spare: { width: 64, height: 64, borderRadius: 10 },
});
