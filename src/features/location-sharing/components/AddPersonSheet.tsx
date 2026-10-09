import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraField, AuraSheet, useAura } from "@/atoms";
import { PrivateView } from "@/modules/analytics";
import { emergencyContactsStorage, normalizeEmail } from "@/features/onboarding/services/emergencyContactsStorage";
import { useLocalization } from "@/localization";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AddPersonSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; email: string }) => Promise<void>;
  onShareLink: () => void;
  onResetLink: () => void;
  existingEmails: Set<string>;
}

/**
 * Adds someone to your circle: first by sharing your circle invite link (joining it puts you in each
 * other's circle), else by email, with saved contacts that have an email offered as one-tap suggestions.
 */
export function AddPersonSheet({ visible, onClose, onSubmit, onShareLink, onResetLink, existingEmails }: AddPersonSheetProps) {
  const { t } = useLocalization();
  const { c, f } = useAura();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () =>
      visible
        ? emergencyContactsStorage.get().filter((c) => c.email && !existingEmails.has(normalizeEmail(c.email)))
        : [],
    [existingEmails, visible],
  );

  const close = () => {
    setName("");
    setEmail("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (saving) return;
    const cleanEmail = normalizeEmail(email);
    if (!name.trim()) return setError(t("sharing.nameRequired"));
    if (!EMAIL_RE.test(cleanEmail)) return setError(t("sharing.emailInvalid"));
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), email: cleanEmail });
      close();
    } catch {
      setError(t("sharing.linkErrorBody"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={close}
      title={t("circle.addTitle")}
      subtitle={t("circle.addLinkBody")}
      footer={<AuraButton label={t("circle.addButton")} variant="secondary" onPress={submit} loading={saving} />}
    >
      <PrivateView>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <AuraButton label={t("circle.inviteLink")} icon="share" onPress={onShareLink} />
        <AuraButton label={t("circle.resetLink")} variant="ghost" size="md" onPress={onResetLink} style={styles.reset} />
        <Text style={[styles.orTitle, { color: c.text, fontFamily: f.semibold }]}>{t("circle.orEmail")}</Text>
        <Text style={[styles.orBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("circle.addBody")}</Text>
        {suggestions.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestions}>
            {suggestions.map((c) => (
              <AuraChip
                key={c.id}
                label={c.name}
                icon="users"
                onPress={() => {
                  setName(c.name);
                  setEmail(c.email ?? "");
                }}
              />
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.fields}>
          <AuraField value={name} onChangeText={setName} placeholder={t("sharing.namePlaceholder")} autoCapitalize="words" maxLength={80} />
          <AuraField
            value={email}
            onChangeText={setEmail}
            placeholder={t("sharing.emailPlaceholder")}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            error={error}
          />
        </View>
      </ScrollView>
      </PrivateView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  reset: { alignSelf: "center", marginTop: 4 },
  orTitle: { fontSize: 15.5, marginTop: 14 },
  orBody: { fontSize: 13.5, lineHeight: 19, marginTop: 2, marginBottom: 12 },
  suggestions: { gap: 8, paddingBottom: 14 },
  fields: { gap: 10 },
});
