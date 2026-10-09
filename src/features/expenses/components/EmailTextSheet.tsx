import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { AuraSheet, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { PrivateView } from "@/modules/analytics";

/** The text of the email a spend or booking came from; it stays on the phone. */
export function EmailTextSheet({ text, onClose }: { text: string | null; onClose: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  return (
    <AuraSheet visible={text !== null} onClose={onClose} title={t("gmailReview.emailTitle")} subtitle={t("gmailReview.emailPrivate")}>
      <PrivateView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator>
          <Text selectable style={[styles.text, { color: c.text, fontFamily: f.regular }]}>
            {text}
          </Text>
        </ScrollView>
      </PrivateView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  text: { fontSize: 13.5, lineHeight: 20 },
});
