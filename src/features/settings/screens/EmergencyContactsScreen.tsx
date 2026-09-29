import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  TextInput,
} from "react-native";
import * as Contacts from "expo-contacts/legacy";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { Screen } from "@/components/layout/Screen";
import { NomadCard } from "@/components/nomad/Card";
import { Icon } from "@/components/nomad/Icon";
import { NomadButton } from "@/components/nomad/Button";
import { Header } from "@/components/layout/Header";
import {
  emergencyContactsStorage,
  type EmergencyContact,
} from "@/features/onboarding/services/emergencyContactsStorage";
import { isValidPhone, normalizePhone } from "@/features/safety/utils/phone";
import { logger } from "@/services/logger";

const SLOT_COLORS = ["teal", "mustard", "sky", "stamp"] as const;
const MAX_CONTACTS = 3;

function hexFromName(theme: NomadTheme, name: string): string {
  return (theme[name as keyof NomadTheme] as string) ?? theme.inkDeep;
}

interface SelectableContact extends EmergencyContact {
  init: string;
  color: string;
}

/** Prefers a mobile number (SMS-capable) over landlines/work numbers. */
function pickBestPhone(numbers: Contacts.PhoneNumber[] | undefined): string | null {
  if (!numbers?.length) return null;
  const mobile = numbers.find((n) => /mobile|cell|iphone/i.test(n.label ?? ""));
  return normalizePhone((mobile ?? numbers[0]).number ?? null);
}

export default function EmergencyContactsScreen() {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();

  const [selected, setSelected] = useState<SelectableContact[]>(() => {
    const stored = emergencyContactsStorage.get();
    return stored.map((c, i) => ({
      ...c,
      phone: normalizePhone(c.phone),
      init: c.name.charAt(0).toUpperCase(),
      color: SLOT_COLORS[i % SLOT_COLORS.length],
    }));
  });
  const [picking, setPicking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    emergencyContactsStorage.set(
      selected.map(({ id, name, phone, email }) => ({ id, name, phone, email })),
    );
  }, [selected]);

  const isFull = selected.length >= MAX_CONTACTS;
  const hasAnyPhone = selected.some((c) => isValidPhone(c.phone));

  const isDuplicate = (list: SelectableContact[], contact: EmergencyContact) =>
    list.some((c) => c.id === contact.id || (!!contact.phone && c.phone === contact.phone));

  const addContact = (contact: EmergencyContact): boolean => {
    if (selected.length >= MAX_CONTACTS || isDuplicate(selected, contact)) return false;
    setSelected((prev) => {
      if (prev.length >= MAX_CONTACTS || isDuplicate(prev, contact)) return prev;
      return [
        ...prev,
        {
          ...contact,
          init: contact.name.charAt(0).toUpperCase(),
          color: SLOT_COLORS[prev.length % SLOT_COLORS.length],
        },
      ];
    });
    return true;
  };

  const openManualEntry = () => {
    setManualError(null);
    setManualOpen(true);
  };

  // Android reads the picked contact via a Data query that needs READ_CONTACTS at runtime.
  const ensureContactsPermission = async (): Promise<boolean> => {
    if (Platform.OS !== "android") return true;
    const { granted } = await Contacts.requestPermissionsAsync();
    if (granted) return true;
    Alert.alert(t("emergencyContacts.permissionTitle"), t("emergencyContacts.permissionBody"), [
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
      const displayName =
        contact.name?.trim() ||
        [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
        contact.company?.trim() ||
        phone ||
        email ||
        t("onboarding.unnamedContact");
      const id = contact.id ?? `picked-${Date.now()}`;

      if (!addContact({ id, name: displayName, phone, email })) {
        Alert.alert(t("settings.emergencyContacts"), t("emergencyContacts.duplicate"));
        return;
      }
      if (!isValidPhone(phone)) {
        Alert.alert(displayName, t("emergencyContacts.noPhoneWarning"));
      }
    } catch (err) {
      logger.warn("contacts", "picker failed", err);
      Alert.alert(t("settings.emergencyContacts"), t("emergencyContacts.pickerFailed"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("emergencyContacts.addManually"), onPress: openManualEntry },
      ]);
    } finally {
      setPicking(false);
    }
  };

  const saveManualContact = () => {
    const name = manualName.trim();
    const phone = normalizePhone(manualPhone);
    if (!name) {
      setManualError(t("emergencyContacts.nameRequired"));
      return;
    }
    if (!isValidPhone(phone)) {
      setManualError(t("emergencyContacts.invalidPhone"));
      return;
    }
    if (!addContact({ id: `manual-${Date.now()}`, name, phone, email: null })) {
      setManualError(t("emergencyContacts.duplicate"));
      return;
    }
    setManualName("");
    setManualPhone("");
    setManualError(null);
    setManualOpen(false);
  };

  const confirmRemoveContact = (contact: SelectableContact) => {
    Alert.alert(
      t("emergencyContacts.confirmRemoveTitle", { name: contact.name }),
      t("emergencyContacts.confirmRemoveBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("emergencyContacts.remove"),
          style: "destructive",
          onPress: () => setSelected((prev) => prev.filter((c) => c.id !== contact.id)),
        },
      ],
    );
  };

  const removeAll = () => {
    Alert.alert(
      t("settings.contactManageTitle"),
      t("emergencyContacts.confirmRemoveBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.clear"),
          style: "destructive",
          onPress: () => setSelected([]),
        },
      ],
    );
  };

  return (
    <Screen scroll keyboardAvoiding edges={["top"]}>
      <Header title={t("settings.emergencyContacts")} showBack />

      <Text style={[styles.lede, { color: theme.inkSoft }]}>
        {t("settings.contactManageBody")}
      </Text>

      {selected.length > 0 && !hasAnyPhone && (
        <NomadCard theme={theme} style={[styles.warningCard, { backgroundColor: theme.stampSoft, borderColor: theme.stamp }]}>
          <View style={styles.warningRow} accessibilityRole="alert">
            <Icon name="alertTriangle" size={18} color={theme.stamp} strokeWidth={2} />
            <Text style={[styles.warningText, { color: theme.inkDeep }]}>
              {t("emergencyContacts.noneWithPhone")}
            </Text>
          </View>
        </NomadCard>
      )}

      <NomadCard theme={theme}>
        <View style={styles.slotRow}>
          {Array.from({ length: MAX_CONTACTS }, (_, slot) => {
            const c = selected[slot];
            if (!c) {
              return (
                <Pressable
                  key={slot}
                  onPress={pickContact}
                  accessibilityRole="button"
                  accessibilityLabel={t("onboarding.chooseFromContacts")}
                  style={[styles.slotEmpty, { borderColor: theme.hairline }]}
                >
                  <Text style={{ color: theme.inkMuted, fontSize: 16 }}>+</Text>
                </Pressable>
              );
            }
            return (
              <View
                key={slot}
                accessible
                accessibilityLabel={c.name}
                style={[
                  styles.slotFilled,
                  {
                    backgroundColor: hexFromName(theme, c.color),
                    borderColor: theme.paperSoft,
                  },
                ]}
              >
                <Text style={styles.slotInit}>{c.init}</Text>
              </View>
            );
          })}
        </View>

        <View style={{ gap: 8 }}>
          <NomadButton
            theme={theme}
            variant="secondary"
            onPress={pickContact}
            disabled={isFull || picking}
            icon={
              picking ? (
                <ActivityIndicator size="small" color={theme.inkDeep} />
              ) : (
                <Icon name="plus" size={16} color={theme.inkDeep} strokeWidth={2.4} />
              )
            }
          >
            {isFull
              ? t("onboarding.trustedThreeFull")
              : t("onboarding.chooseFromContacts")}
          </NomadButton>
          {!isFull && !manualOpen && (
            <NomadButton
              theme={theme}
              variant="ghost"
              onPress={openManualEntry}
              icon={<Icon name="edit" size={16} color={theme.inkDeep} />}
            >
              {t("emergencyContacts.addManually")}
            </NomadButton>
          )}
        </View>
      </NomadCard>

      {manualOpen && !isFull && (
        <NomadCard theme={theme} style={{ marginTop: 14 }}>
          <Text style={[styles.manualTitle, { color: theme.inkDeep }]}>
            {t("emergencyContacts.manualTitle")}
          </Text>
          <TextInput
            value={manualName}
            onChangeText={setManualName}
            placeholder={t("emergencyContacts.namePlaceholder")}
            placeholderTextColor={theme.inkMuted}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            accessibilityLabel={t("emergencyContacts.namePlaceholder")}
            style={[styles.input, { color: theme.inkDeep, borderColor: theme.hairline, backgroundColor: theme.paperSoft }]}
          />
          <TextInput
            value={manualPhone}
            onChangeText={setManualPhone}
            placeholder={t("emergencyContacts.phonePlaceholder")}
            placeholderTextColor={theme.inkMuted}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="done"
            onSubmitEditing={saveManualContact}
            accessibilityLabel={t("emergencyContacts.phonePlaceholder")}
            style={[styles.input, { color: theme.inkDeep, borderColor: theme.hairline, backgroundColor: theme.paperSoft }]}
          />
          {manualError && (
            <Text style={[styles.errorText, { color: theme.stamp }]} accessibilityLiveRegion="polite">
              {manualError}
            </Text>
          )}
          <View style={{ gap: 8, marginTop: 12 }}>
            <NomadButton theme={theme} variant="primary" onPress={saveManualContact}>
              {t("emergencyContacts.save")}
            </NomadButton>
            <NomadButton theme={theme} variant="ghost" onPress={() => setManualOpen(false)}>
              {t("common.cancel")}
            </NomadButton>
          </View>
        </NomadCard>
      )}

      {selected.length > 0 && (
        <View style={{ gap: 10, marginTop: 18 }}>
          {selected.map((c) => {
            const canSms = isValidPhone(c.phone);
            return (
              <NomadCard key={c.id} theme={theme} padding={12}>
                <View style={styles.contactRow}>
                  <View
                    style={[
                      styles.contactAvatar,
                      { backgroundColor: hexFromName(theme, c.color) },
                    ]}
                  >
                    <Text style={styles.contactAvatarText}>{c.init}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.contactName, { color: theme.inkDeep }]}
                    >
                      {c.name}
                    </Text>
                    <Text style={[styles.contactSub, { color: canSms ? theme.inkSoft : theme.stamp }]}>
                      {canSms ? c.phone : t("emergencyContacts.noPhoneWarning")}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => confirmRemoveContact(c)}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t("emergencyContacts.removeA11y", { name: c.name })}
                    style={styles.removeButton}
                  >
                    <Icon
                      name="trash"
                      size={18}
                      color={theme.stamp}
                      strokeWidth={2}
                    />
                  </Pressable>
                </View>
              </NomadCard>
            );
          })}
        </View>
      )}

      {selected.length > 0 && (
        <View style={{ marginTop: 20, marginBottom: 24 }}>
          <NomadButton theme={theme} variant="stamp" onPress={removeAll}>
            {t("common.clear")}
          </NomadButton>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: {
    fontSize: 14,
    lineHeight: 14 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
    marginBottom: 18,
    marginTop: 8,
  },
  warningCard: { marginBottom: 14, borderWidth: 1 },
  warningRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: NOMAD_FONTS.ui,
  },
  slotRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    marginBottom: 18,
  },
  slotEmpty: {
    width: 56,
    height: 56,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  slotFilled: {
    width: 56,
    height: 56,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  slotInit: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 22,
  },
  manualTitle: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: NOMAD_FONTS.ui,
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    fontFamily: NOMAD_FONTS.ui,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  contactAvatar: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 16,
  },
  contactName: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  contactSub: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: NOMAD_FONTS.ui,
  },
  removeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
