import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { useLocalization } from "@/localization";
import { storage } from "@/stores/storage";

const ACCEPTED_KEY = "nomadsafe.bg-location-disclosure-accepted";

export function hasAcceptedBackgroundDisclosure() {
  return storage.getBoolean(ACCEPTED_KEY) === true;
}

export function resetBackgroundDisclosure() {
  storage.remove(ACCEPTED_KEY);
}

interface Props {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Google Play "prominent disclosure" shown before requesting background
 * location. It must name the data, say it's collected while the app is
 * closed, explain the feature, and require an explicit accept.
 */
export function BackgroundLocationDisclosure({ visible, onAccept, onDecline }: Props) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const tealish = "#22C7B8";

  const points: { icon: IconName; text: string }[] = [
    { icon: "mapPin", text: t("locationDisclosure.pointCollect") },
    { icon: "users", text: t("locationDisclosure.pointRecipients") },
    { icon: "bell", text: t("locationDisclosure.pointNotification") },
    { icon: "pause", text: t("locationDisclosure.pointStop") },
  ];

  const accept = () => {
    storage.set(ACCEPTED_KEY, true);
    onAccept();
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={onDecline}
      footer={
        <View style={styles.actions}>
          <AuraButton label={t("locationDisclosure.accept")} onPress={accept} />
          <AuraButton label={t("locationDisclosure.decline")} variant="ghost" onPress={onDecline} />
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.badge, { backgroundColor: `${tealish}22` }]}>
          <Icon name="mapPin" size={26} color={tealish} strokeWidth={2} />
        </View>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]} accessibilityRole="header">
          {t("locationDisclosure.title")}
        </Text>
        <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{t("locationDisclosure.lede")}</Text>
        <View style={[styles.points, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          {points.map((point) => (
            <View key={point.text} style={styles.point}>
              <Icon name={point.icon} size={18} color={tealish} />
              <Text style={[styles.pointText, { color: c.text, fontFamily: f.regular }]}>{point.text}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.footnote, { color: c.textMuted, fontFamily: f.regular }]}>{t("locationDisclosure.footnote")}</Text>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 8, gap: 14 },
  badge: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, letterSpacing: -0.6, lineHeight: 31 },
  lede: { fontSize: 15, lineHeight: 22 },
  points: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  point: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  pointText: { flex: 1, fontSize: 14.5, lineHeight: 21 },
  footnote: { fontSize: 12.5, lineHeight: 18 },
  actions: { gap: 4 },
});
