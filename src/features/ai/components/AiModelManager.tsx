import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { useChatStore } from "../store/chatStore";
import { AiProvisionCard } from "./AiProvisionCard";

interface Props {
  theme: NomadTheme;
}

export function AiModelManager({ theme }: Props) {
  const { t } = useLocalization();
  const isModelBusy = useChatStore((state) => state.generatingConversationKey !== null);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <NomadCard theme={theme} style={styles.introCard}>
        <View style={styles.iconMarkWrap}>
          <View style={[styles.iconMark, { backgroundColor: theme.tealSoft }]}>
            <Icon name="sparkle" size={28} color={theme.teal} strokeWidth={2} />
          </View>
        </View>
        <Text style={[styles.introTitle, { color: theme.inkDeep }]}>{t("aiTab.introTitle")}</Text>
        <Text style={[styles.introBody, { color: theme.inkSoft }]}>{t("aiTab.provision.introBody")}</Text>
      </NomadCard>

      <AiProvisionCard theme={theme} mode="manage" busy={isModelBusy} />

      <Text style={[styles.footer, { color: theme.inkMuted }]}>{t("aiTab.privacyFooter")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 120 },
  introCard: { alignItems: "center", marginBottom: 18, paddingVertical: 24 },
  iconMarkWrap: { alignItems: "center", marginBottom: 14 },
  iconMark: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  introTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 24,
    textAlign: "center",
    lineHeight: 28,
  },
  introBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 8,
  },
  footer: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10.5,
    textAlign: "center",
    letterSpacing: 0.4,
    marginTop: 18,
  },
});
