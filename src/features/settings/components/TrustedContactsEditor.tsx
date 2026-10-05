import React, { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Contacts from "expo-contacts/legacy";
import {
  AuraButton,
  AuraCard,
  AuraField,
  AuraListGroup,
  AuraListRow,
  AuraSheet,
  Icon,
  PressableScale,
  showAlert,
  useAura,
} from "@/atoms";
import { auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { emergencyContactsStorage, type EmergencyContact } from "@/features/onboarding/services/emergencyContactsStorage";
import { isValidPhone, normalizePhone } from "@/features/safety/utils/phone";
import { withSystemPrompt } from "@/utils/systemPrompt";

export const MAX_TRUSTED_CONTACTS = 3;

export interface TrustedContactsSummary {
  count: number;
  withPhone: number;
}

const AVATAR_TONES = [...auraStatusColors.calm, auraStatusAccent.live];

/** Prefers a mobile number (SMS-capable) over landlines/work numbers. */
function pickBestPhone(numbers: Contacts.PhoneNumber[] | undefined): string | null {
  if (!numbers?.length) return null;
  const mobile = numbers.find((n) => /mobile|cell|iphone/i.test(n.label ?? ""));
  return normalizePhone((mobile ?? numbers[0]).number ?? null);
}

const isDuplicate = (list: EmergencyContact[], contact: EmergencyContact) =>
  list.some((c) => c.id === contact.id || (!!contact.phone && c.phone === contact.phone));

/**
 * Up to three trusted contacts, saved to `emergencyContactsStorage` on every change. Contacts come
 * from the system picker or manual entry; used by onboarding and the emergency contacts screen.
 */
export function TrustedContactsEditor({ onChange }: { onChange?: (summary: TrustedContactsSummary) => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [contacts, setContacts] = useState<EmergencyContact[]>(() =>
    emergencyContactsStorage.get().map((contact) => ({ ...contact, phone: normalizePhone(contact.phone) })),
  );
  const [picking, setPicking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const isFull = contacts.length >= MAX_TRUSTED_CONTACTS;
  const withPhone = contacts.filter((contact) => isValidPhone(contact.phone)).length;

  useEffect(() => {
    emergencyContactsStorage.set(contacts.map(({ id, name, phone, email }) => ({ id, name, phone, email })));
    onChange?.({ count: contacts.length, withPhone });
  }, [contacts, withPhone, onChange]);

  const addContact = (contact: EmergencyContact): boolean => {
    if (isFull || isDuplicate(contacts, contact)) return false;
    setContacts((prev) => (prev.length >= MAX_TRUSTED_CONTACTS || isDuplicate(prev, contact) ? prev : [...prev, contact]));
    return true;
  };

  const openManualEntry = () => {
    setManualError(null);
    setManualOpen(true);
  };

  // Android reads the picked contact via a Data query that needs READ_CONTACTS at runtime.
  const ensureContactsPermission = async (): Promise<boolean> => {
    if (Platform.OS !== "android") return true;
    const { granted } = await withSystemPrompt(() => Contacts.requestPermissionsAsync());
    if (granted) return true;
    showAlert(t("emergencyContacts.permissionTitle"), t("emergencyContacts.permissionBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("emergencyContacts.addManually"), onPress: openManualEntry },
      { text: t("emergencyContacts.openSettings"), onPress: () => Linking.openSettings() },
    ]);
    return false;
  };

  const pickContact = async () => {
    if (isFull || picking) return;
    setPicking(true);
    try {
      if (!(await ensureContactsPermission())) return;
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;
      const phone = pickBestPhone(contact.phoneNumbers);
      const email = contact.emails?.[0]?.email ?? null;
      const name =
        contact.name?.trim() ||
        [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
        contact.company?.trim() ||
        phone ||
        email ||
        t("onboarding.unnamedContact");
      if (!addContact({ id: contact.id ?? `picked-${Date.now()}`, name, phone, email })) {
        showAlert(t("settings.emergencyContacts"), t("emergencyContacts.duplicate"));
        return;
      }
      if (!isValidPhone(phone)) showAlert(name, t("emergencyContacts.noPhoneWarning"));
    } catch (err) {
      logger.warn("contacts", "picker failed", err);
      showAlert(t("settings.emergencyContacts"), t("emergencyContacts.pickerFailed"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("emergencyContacts.addManually"), onPress: openManualEntry },
      ]);
    } finally {
      setPicking(false);
    }
  };

  const saveManual = () => {
    const name = manualName.trim();
    const phone = normalizePhone(manualPhone);
    if (!name) return setManualError(t("emergencyContacts.nameRequired"));
    if (!isValidPhone(phone)) return setManualError(t("emergencyContacts.invalidPhone"));
    if (!addContact({ id: `manual-${Date.now()}`, name, phone, email: null })) return setManualError(t("emergencyContacts.duplicate"));
    setManualName("");
    setManualPhone("");
    setManualError(null);
    setManualOpen(false);
  };

  const confirmRemove = (contact: EmergencyContact) =>
    showAlert(t("emergencyContacts.confirmRemoveTitle", { name: contact.name }), t("emergencyContacts.confirmRemoveBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("emergencyContacts.remove"),
        style: "destructive",
        onPress: () => setContacts((prev) => prev.filter((entry) => entry.id !== contact.id)),
      },
    ]);

  return (
    <PrivateView>
      {contacts.length > 0 && withPhone === 0 ? (
        <AuraCard tone={auraStatusAccent.alert} style={styles.warning}>
          <View style={styles.warningRow} accessibilityRole="alert">
            <Icon name="alertTriangle" size={17} color={auraStatusAccent.alert} />
            <Text style={[styles.warningText, { color: c.text, fontFamily: f.regular }]}>{t("emergencyContacts.noneWithPhone")}</Text>
          </View>
        </AuraCard>
      ) : null}

      {contacts.length > 0 ? (
        <AuraListGroup style={styles.list}>
          {contacts.map((contact, index) => {
            const tone = AVATAR_TONES[index % AVATAR_TONES.length];
            const canSms = isValidPhone(contact.phone);
            return (
              <View key={contact.id} style={styles.contactRow}>
                <View style={[styles.avatar, { backgroundColor: `${tone}2E` }]}>
                  <Text style={[styles.initial, { color: tone, fontFamily: f.semibold }]}>{contact.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                    {contact.name}
                  </Text>
                  <Text
                    style={[styles.phone, { color: canSms ? c.textMuted : auraStatusAccent.alert, fontFamily: f.regular }]}
                    numberOfLines={1}
                  >
                    {canSms ? contact.phone : t("emergencyContacts.noPhoneWarning")}
                  </Text>
                </View>
                <PressableScale
                  onPress={() => confirmRemove(contact)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t("emergencyContacts.removeA11y", { name: contact.name })}
                  style={[styles.remove, { backgroundColor: c.surfaceStrong }]}
                >
                  <Icon name="trash" size={15} color={c.textSoft} />
                </PressableScale>
              </View>
            );
          })}
        </AuraListGroup>
      ) : null}

      <AuraListGroup style={styles.list}>
        <AuraListRow
          icon="users"
          label={isFull ? t("onboarding.trustedThreeFull") : t("onboarding.chooseFromContacts")}
          disabled={isFull || picking}
          onPress={() => void pickContact()}
        />
        <AuraListRow icon="phone" label={t("emergencyContacts.addManually")} disabled={isFull} onPress={openManualEntry} />
      </AuraListGroup>

      <AuraSheet
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        title={t("emergencyContacts.manualTitle")}
        footer={<AuraButton label={t("emergencyContacts.save")} onPress={saveManual} />}
      >
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <AuraField
            value={manualName}
            onChangeText={setManualName}
            placeholder={t("emergencyContacts.namePlaceholder")}
            accessibilityLabel={t("emergencyContacts.namePlaceholder")}
            autoFocus
          />
          <AuraField
            value={manualPhone}
            onChangeText={setManualPhone}
            placeholder={t("emergencyContacts.phonePlaceholder")}
            accessibilityLabel={t("emergencyContacts.phonePlaceholder")}
            keyboardType="phone-pad"
            error={manualError}
          />
        </ScrollView>
      </AuraSheet>
    </PrivateView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  warning: { marginTop: 16 },
  warningRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  warningText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  list: { marginTop: 16 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 16 },
  name: { fontSize: 15.5 },
  phone: { fontSize: 12.5, marginTop: 2 },
  remove: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  sheetBody: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12, gap: 12 },
});
