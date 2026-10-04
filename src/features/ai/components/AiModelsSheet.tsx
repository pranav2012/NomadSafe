import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraListGroup, AuraListRow, AuraSheet, Icon, useAura } from "@/atoms";
import { auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { byokProviderName, useAiSources, useByokStore } from "@/modules/ai";
import { useChatStore } from "../store/chatStore";
import { AiProvisionCard } from "./AiProvisionCard";

const [INDIGO, , VIOLET] = auraStatusColors.calm;

/** Sheet for AI sources: which one answers, the on-device model's status and the user's own API key. */
export function AiModelsSheet({ visible, onClose, onOpenKey }: { visible: boolean; onClose: () => void; onOpenKey: () => void }) {
  const { c, f, accent } = useAura();
  const { t } = useLocalization();
  const isModelBusy = useChatStore((state) => state.generatingConversationKey !== null);
  const byok = useByokStore((s) => s.summary);
  const aiSources = useAiSources();

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

        {aiSources.sources.length > 1 ? (
          <AuraListGroup title={t("aiSource.pickerTitle")} footer={t("aiSource.pickerFootnote")} style={styles.group}>
            {aiSources.sources.map((source) => (
              <AuraListRow
                key={source.id}
                icon={source.online ? "globe" : "cpu"}
                tone={source.online ? INDIGO : VIOLET}
                label={source.label}
                detail={source.detail}
                trailing={source.id === aiSources.current ? <Icon name="check" size={18} color={accent} strokeWidth={2.2} /> : <View />}
                onPress={() => aiSources.select(source.id)}
              />
            ))}
          </AuraListGroup>
        ) : null}

        <AuraListGroup style={styles.group}>
          <AuraListRow
            icon="lock"
            tone={auraStatusAccent.live}
            label={t("settings.aiKey")}
            detail={t("settings.aiKeySub")}
            value={byok ? byokProviderName(byok) : t("settings.aiKeyNone")}
            onPress={onOpenKey}
          />
        </AuraListGroup>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  introTitle: { fontSize: 17 },
  introBody: { fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  card: { marginTop: 18, padding: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  group: { marginTop: 18 },
  privacy: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  privacyText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
});
