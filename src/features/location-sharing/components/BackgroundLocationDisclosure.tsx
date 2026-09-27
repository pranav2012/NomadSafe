import React from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NomadButton } from "@/components/nomad/Button";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
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
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();

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
    <Modal visible={visible} animationType="slide" onRequestClose={onDecline} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: theme.paper }]}>
        <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.badge, { backgroundColor: theme.tealSoft }]}>
              <Icon name="mapPin" size={28} color={theme.teal} strokeWidth={2} />
            </View>
            <Text style={[styles.title, { color: theme.inkDeep }]} accessibilityRole="header">
              {t("locationDisclosure.title")}
            </Text>
            <Text style={[styles.lede, { color: theme.inkSoft }]}>{t("locationDisclosure.lede")}</Text>

            <View style={styles.points}>
              {points.map((point) => (
                <View key={point.text} style={styles.point}>
                  <Icon name={point.icon} size={18} color={theme.teal} />
                  <Text style={[styles.pointText, { color: theme.inkDeep }]}>{point.text}</Text>
                </View>
              ))}
            </View>

            <Text style={[styles.footnote, { color: theme.inkMuted }]}>{t("locationDisclosure.footnote")}</Text>
          </ScrollView>

          <View style={styles.actions}>
            <NomadButton theme={theme} variant="teal" full onPress={accept}>
              {t("locationDisclosure.accept")}
            </NomadButton>
            <NomadButton theme={theme} variant="ghost" full onPress={onDecline}>
              {t("locationDisclosure.decline")}
            </NomadButton>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "500",
  },
  lede: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 15.5,
    lineHeight: 23,
    marginTop: 12,
  },
  points: { gap: 16, marginTop: 24 },
  point: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  pointText: {
    flex: 1,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 15,
    lineHeight: 22,
  },
  footnote: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 24,
  },
  actions: { paddingHorizontal: 24, paddingBottom: 12, gap: 8 },
});
