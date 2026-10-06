import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraSheet, useAura } from "@/atoms";
import { api, useAction } from "@/modules/backend";
import { withAppCheck } from "@/modules/appCheck";
import { PrivateView } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import type { TripEvent } from "@/features/itinerary";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { useTravelInfoStore } from "@/features/trips/store/travelInfoStore";
import { useLocalization } from "@/localization";
import type { HomeStop } from "@/features/home/types";

/**
 * Where you're staying in big type and the local language, to show a taxi driver. Looked up once per
 * stay (Google Places, in the destination's language) and kept on the phone for offline use.
 */
export function DriverCard({ stay, stop, language, onClose }: { stay: TripEvent | null; stop: HomeStop | undefined; language: string; onClose: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const lookup = useAction(api.places.localAddress);
  const cached = useTravelInfoStore((state) => (stay ? state.addresses[stay.id] : undefined));
  const setAddress = useTravelInfoStore((state) => state.setAddress);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = stay !== null && failedFor === stay.id;

  useEffect(() => {
    if (!stay || !stop || cached) return;
    let cancelled = false;
    withAppCheck({ query: stay.title, latitude: stop.latitude, longitude: stop.longitude, language })
      .then(lookup)
      .then((result) => {
        if (cancelled) return;
        if (result) setAddress(stay.id, result);
        else setFailedFor(stay.id);
      })
      .catch((error: unknown) => {
        logger.warn("travel-info", "address lookup failed", error);
        if (!cancelled) setFailedFor(stay.id);
      });
    return () => {
      cancelled = true;
    };
  }, [cached, language, lookup, setAddress, stay, stop]);

  const bookingName = stay ? localizeEventTitle(stay.title, t) : "";
  return (
    <AuraSheet visible={stay !== null} onClose={onClose} title={t("passBack.showDriver")} full>
      <PrivateView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          {cached ? (
            <>
              <Text style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>{cached.name}</Text>
              <Text selectable style={[styles.address, { color: c.text, fontFamily: f.medium }]}>
                {cached.address}
              </Text>
              {cached.name !== bookingName ? <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{bookingName}</Text> : null}
              {cached.mapsUrl ? (
                <AuraButton icon="mapPin" variant="secondary" label={t("passBack.openMaps")} onPress={() => void Linking.openURL(cached.mapsUrl!)} />
              ) : null}
            </>
          ) : failed ? (
            <>
              <Text style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>{bookingName}</Text>
              <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("passBack.addressUnavailable")}</Text>
            </>
          ) : (
            <View style={styles.loading}>
              <ActivityIndicator color={c.textSoft} />
            </View>
          )}
        </ScrollView>
      </PrivateView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 24, gap: 18 },
  name: { fontSize: 32, lineHeight: 40, letterSpacing: -0.5 },
  address: { fontSize: 26, lineHeight: 36 },
  hint: { fontSize: 15, lineHeight: 21 },
  loading: { paddingVertical: 60, alignItems: "center" },
});
