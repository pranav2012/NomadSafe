import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraChip } from "@/components/aura/AuraChip";
import { AuraField } from "@/components/aura/AuraField";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import type { IconName } from "@/components/nomad/Icon";
import { useLocalization } from "@/localization";
import { smsFallbackStorage, type SmsTemplatePurpose } from "@/features/safety/services/smsFallbackStorage";

const PURPOSES: { purpose: SmsTemplatePurpose; labelKey: string; icon: IconName }[] = [
  { purpose: "missedCheckIn", labelKey: "settings.smsMissedCheckIn", icon: "clock" },
  { purpose: "sos", labelKey: "settings.smsSos", icon: "alertTriangle" },
  { purpose: "invite", labelKey: "settings.smsInvite", icon: "mail" },
  { purpose: "other", labelKey: "settings.smsOther", icon: "messageCircle" },
];

const GSM_BASIC = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
const GSM_EXTENDED = /[\^{}\\[~\]|€]/g;

/** SMS parts: GSM-7 is 160 (153 split, extended chars count 2); otherwise UCS-2 at 70 (67 split). */
function countSmsSegments(text: string): number {
  if (!text) return 1;
  if (GSM_BASIC.test(text)) {
    const units = text.length + (text.match(GSM_EXTENDED)?.length ?? 0);
    return units <= 160 ? 1 : Math.ceil(units / 153);
  }
  const units = [...text].reduce((sum, char) => sum + (char.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

function loadDrafts(): Record<SmsTemplatePurpose, string> {
  return {
    missedCheckIn: smsFallbackStorage.get("missedCheckIn"),
    sos: smsFallbackStorage.get("sos"),
    invite: smsFallbackStorage.get("invite"),
    other: smsFallbackStorage.get("other"),
  };
}

/** Editor for the SMS fallback templates, one per alert type; Save writes every edited template. */
export function SmsTemplatesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [purpose, setPurpose] = useState<SmsTemplatePurpose>("missedCheckIn");
  const [drafts, setDrafts] = useState(loadDrafts);
  const [wasVisible, setWasVisible] = useState(visible);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDrafts(loadDrafts());
      setPurpose("missedCheckIn");
    }
  }

  const draft = drafts[purpose];

  const save = () => {
    PURPOSES.forEach(({ purpose: key }) => smsFallbackStorage.set(key, drafts[key]));
    onClose();
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={t("settings.smsTemplateTitle")}
      subtitle={t("settings.smsTemplateBody")}
      footer={<AuraButton label={t("settings.smsTemplateSave")} onPress={save} />}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.chips}>
          {PURPOSES.map((option) => (
            <AuraChip
              key={option.purpose}
              label={t(option.labelKey)}
              icon={option.icon}
              selected={option.purpose === purpose}
              onPress={() => setPurpose(option.purpose)}
            />
          ))}
        </View>
        <AuraField
          value={draft}
          onChangeText={(text) => setDrafts((prev) => ({ ...prev, [purpose]: text }))}
          placeholder={t("settings.smsTemplatePlaceholder")}
          accessibilityLabel={t(PURPOSES.find((option) => option.purpose === purpose)!.labelKey)}
          autoCapitalize="sentences"
          multiline
          textAlignVertical="top"
          style={styles.input}
        />
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: c.textMuted, fontFamily: f.regular }]}>{t("settings.smsChars", { count: draft.length })}</Text>
          <Text style={[styles.metaText, { color: c.textMuted, fontFamily: f.regular }]}>
            {t("settings.smsSegments", { count: countSmsSegments(draft) })}
          </Text>
        </View>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12, gap: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { minHeight: 132, maxHeight: 220 },
  meta: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: 4 },
  metaText: { fontSize: 12.5 },
});
