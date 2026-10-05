import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { AuraListGroup, AuraListRow, Icon, PressableScale, showAlert, useAura, AuraTopFade } from "@/atoms";
import { useLocalization } from "@/localization";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { TrustedContactsEditor } from "@/features/settings/components/TrustedContactsEditor";

export default function EmergencyContactsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const [count, setCount] = useState(() => emergencyContactsStorage.get().length);
  // Bumped after "Clear all" so the editor remounts and re-reads the now-empty storage.
  const [editorKey, setEditorKey] = useState(0);

  const clearAll = () => {
    showAlert(t("settings.contactManageTitle"), t("emergencyContacts.confirmRemoveBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.clear"),
        style: "destructive",
        onPress: () => {
          emergencyContactsStorage.set([]);
          setEditorKey((key) => key + 1);
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          style={[styles.back, { backgroundColor: c.surfaceStrong }]}
        >
          <Icon name="chevronLeft" size={18} color={c.text} />
        </PressableScale>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("settings.emergencyContacts")}</Text>
        <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{t("settings.contactManageBody")}</Text>

        <TrustedContactsEditor key={editorKey} onChange={(summary) => setCount(summary.count)} />

        {count > 0 ? (
          <AuraListGroup>
            <AuraListRow icon="trash" destructive label={t("emergencyContacts.clearAll")} onPress={clearAll} />
          </AuraListGroup>
        ) : null}
      </ScrollView>
      <AuraTopFade />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 34, letterSpacing: -1.2, marginTop: 18 },
  lede: { fontSize: 15, lineHeight: 22, marginTop: 6 },
});
