import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { useLocalization } from "@/localization";
import { useChatStore } from "../store/chatStore";
import { AiProvisionCard } from "./AiProvisionCard";

/** Sheet for the on-device model: what it is, download / remove status, and where it runs. */
export function AiModelsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const isModelBusy = useChatStore((state) => state.generatingConversationKey !== null);

  return (
    <AuraSheet visible={visible} onClose={onClose} title={t("aiTab.modelTab")}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={[styles.introTitle, { color: c.text, fontFamily: f.semibold }]}>{t("aiTab.introTitle")}</Text>
        <Text style={[styles.introBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("aiTab.provision.introBody")}</Text>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <AiProvisionCard mode="manage" busy={isModelBusy} />
        </View>

        <View style={styles.privacy}>
          <Icon name="lock" size={12} color={c.textMuted} strokeWidth={2} />
          <Text style={[styles.privacyText, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiTab.privacyFooter")}</Text>
        </View>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  introTitle: { fontSize: 17 },
  introBody: { fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  card: { marginTop: 18, padding: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  privacy: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16 },
  privacyText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
});
