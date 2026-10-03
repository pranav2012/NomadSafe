import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraChip } from "@/components/aura/AuraChip";
import { AuraField } from "@/components/aura/AuraField";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { emergencyContactsStorage, normalizeEmail } from "@/features/onboarding/services/emergencyContactsStorage";
import { useLocalization } from "@/localization";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AddPersonSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; email: string; phone?: string }) => Promise<void>;
  existingEmails: Set<string>;
}

/** Sends a sharing request by email, with emergency contacts offered as one-tap suggestions. */
export function AddPersonSheet({ visible, onClose, onSubmit, existingEmails }: AddPersonSheetProps) {
  const { t } = useLocalization();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
    setPhone("");
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
      await onSubmit({ name: name.trim(), email: cleanEmail, phone: phone.trim() || undefined });
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
      title={t("sharing.addTitle")}
      subtitle={t("sharing.addBody")}
      footer={<AuraButton label={t("sharing.sendRequest")} onPress={submit} loading={saving} />}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
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
                  setPhone(c.phone ?? "");
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
          />
          <AuraField
            value={phone}
            onChangeText={setPhone}
            placeholder={t("sharing.phonePlaceholder")}
            keyboardType="phone-pad"
            maxLength={32}
            error={error}
          />
        </View>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  suggestions: { gap: 8, paddingBottom: 14 },
  fields: { gap: 10 },
});
