import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
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

const SLOT_COLORS = ["teal", "mustard", "sky", "stamp"] as const;

function hexFromName(theme: NomadTheme, name: string): string {
  return (theme[name as keyof NomadTheme] as string) ?? theme.inkDeep;
}

interface SelectableContact extends EmergencyContact {
  init: string;
  color: string;
}

export default function EmergencyContactsScreen() {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();

  const [selected, setSelected] = useState<SelectableContact[]>(() => {
    const stored = emergencyContactsStorage.get();
    return stored.map((c, i) => ({
      ...c,
      init: c.name.charAt(0).toUpperCase(),
      color: SLOT_COLORS[i % SLOT_COLORS.length],
    }));
  });
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    emergencyContactsStorage.set(
      selected.map(({ id, name, phone, email }) => ({ id, name, phone, email })),
    );
  }, [selected]);

  const pickContact = async () => {
    if (selected.length >= 3 || picking) return;
    setPicking(true);
    try {
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;

      const phone = contact.phoneNumbers?.[0]?.number ?? null;
      const email = contact.emails?.[0]?.email ?? null;
      const displayName =
        contact.name?.trim() ||
        [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
        contact.company?.trim() ||
        phone ||
        email ||
        t("onboarding.unnamedContact");
      const id = contact.id ?? `picked-${Date.now()}`;

      setSelected((prev) => {
        if (prev.length >= 3 || prev.some((c) => c.id === id)) return prev;
        return [
          ...prev,
          {
            id,
            name: displayName,
            phone,
            email,
            init: displayName.charAt(0).toUpperCase(),
            color: SLOT_COLORS[prev.length % SLOT_COLORS.length],
          },
        ];
      });
    } catch (err) {
      console.warn("Contact picker failed", err);
    } finally {
      setPicking(false);
    }
  };

  const removeContact = (id: string) => {
    setSelected((prev) => prev.filter((c) => c.id !== id));
  };

  const removeAll = () => {
    Alert.alert(
      t("settings.contactManageTitle"),
      t("settings.contactManageBody"),
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
    <Screen scroll edges={["top"]}>
      <Header title={t("settings.emergencyContacts")} showBack />

      <Text style={[styles.lede, { color: theme.inkSoft }]}>
        {t("settings.contactManageBody")}
      </Text>

      <NomadCard theme={theme}>
        <View style={styles.slotRow}>
          {[0, 1, 2].map((slot) => {
            const c = selected[slot];
            if (!c) {
              return (
                <Pressable
                  key={slot}
                  onPress={pickContact}
                  style={[styles.slotEmpty, { borderColor: theme.hairline }]}
                >
                  <Text style={{ color: theme.inkMuted, fontSize: 16 }}>+</Text>
                </Pressable>
              );
            }
            return (
              <Pressable
                key={slot}
                onPress={() => removeContact(c.id)}
                style={[
                  styles.slotFilled,
                  {
                    backgroundColor: hexFromName(theme, c.color),
                    borderColor: theme.paperSoft,
                  },
                ]}
              >
                <Text style={styles.slotInit}>{c.init}</Text>
              </Pressable>
            );
          })}
        </View>

        <NomadButton
          theme={theme}
          variant="secondary"
          onPress={pickContact}
          disabled={selected.length >= 3 || picking}
          icon={
            picking ? (
              <ActivityIndicator size="small" color={theme.inkDeep} />
            ) : (
              <Icon name="plus" size={16} color={theme.inkDeep} strokeWidth={2.4} />
            )
          }
        >
          {selected.length >= 3
            ? t("onboarding.trustedThreeFull")
            : t("onboarding.chooseFromContacts")}
        </NomadButton>
      </NomadCard>

      {selected.length > 0 && (
        <View style={{ gap: 10, marginTop: 18 }}>
          {selected.map((c) => (
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
                  <Text style={[styles.contactSub, { color: theme.inkSoft }]}>
                    {c.phone ?? c.email ?? t("onboarding.noPhone")}
                  </Text>
                </View>
                <Pressable onPress={() => removeContact(c.id)} hitSlop={8}>
                  <Icon
                    name="x"
                    size={18}
                    color={theme.stamp}
                    strokeWidth={2.4}
                  />
                </Pressable>
              </View>
            </NomadCard>
          ))}
        </View>
      )}

      {selected.length > 0 && (
        <View style={{ marginTop: 20 }}>
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
});
