import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  TextInput,
} from "react-native";
import Svg, { Line, Path, Polygon } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import * as Contacts from "expo-contacts/legacy";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { NomadCard } from "@/components/nomad/Card";
import { NomadButton } from "@/components/nomad/Button";
import { TravelMap } from "@/components/nomad/TravelMap";
import { Icon } from "@/components/nomad/Icon";
import {
  Eyebrow,
  HugeHeadline,
  HeadlineItalic,
  SectionLabel,
} from "@/components/nomad/Typography";
import {
  permissionsService,
  type PermissionStatus,
} from "@/features/onboarding/services/permissions";
import {
  emergencyContactsStorage,
  type EmergencyContact,
} from "@/features/onboarding/services/emergencyContactsStorage";
import { isValidPhone, normalizePhone } from "@/features/safety/utils/phone";
import { ToggleRow } from "@/features/onboarding/components/ToggleRow";
import { logger } from "@/services/logger";

export interface ContactsSummary {
  count: number;
  withPhone: number;
}

interface Props {
  theme: NomadTheme;
  dark: boolean;
  totalSteps: number;
  onContactsChange?: (summary: ContactsSummary) => void;
}

interface SelectableContact extends EmergencyContact {
  init: string;
  color: string;
}

const SLOT_COLORS = ["teal", "mustard", "sky", "stamp"] as const;
const MAX_CONTACTS = 3;

function hexFromName(
  theme: NomadTheme,
  name: string,
): string {
  return (theme[name as keyof NomadTheme] as string) ?? theme.inkDeep;
}

function toSelectable(contact: EmergencyContact, index: number): SelectableContact {
  return {
    ...contact,
    init: contact.name.charAt(0).toUpperCase(),
    color: SLOT_COLORS[index % SLOT_COLORS.length],
  };
}

/** Prefers a mobile number (SMS-capable) over landlines/work numbers. */
function pickBestPhone(numbers: Contacts.PhoneNumber[] | undefined): string | null {
  if (!numbers?.length) return null;
  const mobile = numbers.find((n) => /mobile|cell|iphone/i.test(n.label ?? ""));
  return normalizePhone((mobile ?? numbers[0]).number ?? null);
}

export function SafetyStep({
  theme,
  dark,
  totalSteps,
  onContactsChange,
}: Props) {
  const { t, isRTL } = useLocalization();

  const [location, setLocation] = useState<PermissionStatus | null>(null);
  const [notifications, setNotifications] = useState<PermissionStatus | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<SelectableContact[]>(() =>
    emergencyContactsStorage.get().map((c, i) => toSelectable({ ...c, phone: normalizePhone(c.phone) }, i)),
  );
  const [picking, setPicking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const isFull = selectedContacts.length >= MAX_CONTACTS;
  const withPhone = selectedContacts.filter((c) => isValidPhone(c.phone)).length;

  // Re-read on return from system Settings so the rows reflect the real grant.
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      permissionsService.checkAll().then((status) => {
        if (!mounted) return;
        setLocation(status.location);
        setNotifications(status.notifications);
      });
    refresh();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    emergencyContactsStorage.set(
      selectedContacts.map(({ id, name, phone, email }) => ({ id, name, phone, email })),
    );
    onContactsChange?.({ count: selectedContacts.length, withPhone });
  }, [selectedContacts, withPhone, onContactsChange]);

  const permissionSub = (
    status: PermissionStatus | null,
    copy: { granted: string; ask: string; denied: string },
  ) => {
    if (status?.granted) return copy.granted;
    if (status && !status.canAskAgain) return t("onboarding.permissionDeniedSettings");
    if (status?.denied) return copy.denied;
    return copy.ask;
  };

  const requestOrOpenSettings = async (
    status: PermissionStatus | null,
    request: () => Promise<PermissionStatus>,
    apply: (next: PermissionStatus) => void,
  ) => {
    if (status?.granted) return;
    if (status && !status.canAskAgain) {
      Linking.openSettings().catch(() => {});
      return;
    }
    apply(await request());
  };

  const onLocationPress = () =>
    requestOrOpenSettings(location, permissionsService.requestLocation, setLocation);

  const onNotificationsPress = () =>
    requestOrOpenSettings(notifications, permissionsService.requestNotifications, setNotifications);

  const isDuplicate = (list: SelectableContact[], contact: EmergencyContact) =>
    list.some((c) => c.id === contact.id || (!!contact.phone && c.phone === contact.phone));

  const addContact = (contact: EmergencyContact): boolean => {
    if (selectedContacts.length >= MAX_CONTACTS || isDuplicate(selectedContacts, contact)) return false;
    setSelectedContacts((prev) => {
      if (prev.length >= MAX_CONTACTS || isDuplicate(prev, contact)) return prev;
      return [...prev, toSelectable(contact, prev.length)];
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
    const { granted } = await permissionsService.requestContacts();
    if (granted) return true;
    Alert.alert(t("emergencyContacts.permissionTitle"), t("emergencyContacts.permissionBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("emergencyContacts.addManually"), onPress: openManualEntry },
      { text: t("emergencyContacts.openSettings"), onPress: () => Linking.openSettings().catch(() => {}) },
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

      // The picked contact can lack a composed `name` (e.g. first/last only).
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
        Alert.alert(t("onboarding.trustedContactsTitle"), t("emergencyContacts.duplicate"));
        return;
      }
      if (!isValidPhone(phone)) {
        Alert.alert(displayName, t("emergencyContacts.noPhoneWarning"));
      }
    } catch (err) {
      logger.warn("onboarding", "contact picker failed", err);
      Alert.alert(t("onboarding.trustedContactsTitle"), t("emergencyContacts.pickerFailed"), [
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

  const removeContact = (id: string) => {
    setSelectedContacts((prev) => prev.filter((c) => c.id !== id).map(toSelectable));
  };

  const slotNames =
    selectedContacts.map((c) => c.name).join(" · ") ||
    t("onboarding.pickUpToThree");

  const mapPins = [
    { x: 110, y: 120, color: theme.stamp, pulse: true },
    { x: 220, y: 85, color: theme.teal },
    { x: 280, y: 160, color: theme.mustard },
  ];

  const exampleContactName = t("onboarding.mumUpper");

  return (
    <View style={{ flex: 1 }}>
      {/* Headline */}
      <View style={{ paddingHorizontal: 26, paddingTop: 6, paddingBottom: 18 }}>
        <Eyebrow color={theme.teal}>
          {t("onboarding.stepOf", { step: 1, total: totalSteps })}
        </Eyebrow>
        <HugeHeadline color={theme.inkDeep}>
          {t("onboarding.safetyHeadlinePrefix")}{" "}
          <HeadlineItalic>{t("onboarding.safetyHeadlineAccent")}</HeadlineItalic>.
        </HugeHeadline>
        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          {t("onboarding.safetyLede")}
        </Text>
      </View>

      {/* 01 · LOCATION */}
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={1}
            color={theme.teal}
            title={t("onboarding.location")}
            theme={theme}
          />
        </View>
        <NomadCard
          theme={theme}
          padding={10}
          style={{ position: "relative", overflow: "hidden" }}
        >
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={t("onboarding.mapExampleCaption")}
          >
            <TravelMap
              theme={theme}
              dark={dark}
              pins={mapPins}
              height={148}
              route={[
                { x: 110, y: 120 },
                { x: 160, y: 100 },
                { x: 220, y: 85 },
                { x: 250, y: 120 },
                { x: 280, y: 160 },
              ]}
            />
          </View>
          <View style={[styles.exampleTag, { backgroundColor: "rgba(26,22,18,0.88)" }]}>
            <Text style={[styles.exampleTagText, { color: theme.paperSoft }]}>
              {t("onboarding.exampleTag")}
            </Text>
          </View>
        </NomadCard>
        <Text style={[styles.caption, { color: theme.inkMuted }]}>
          {t("onboarding.mapExampleCaption")}
        </Text>
        <Text style={[styles.bodyCopy, { color: theme.inkSoft }]}>
          {t("onboarding.locationBody")}
        </Text>

        <View style={{ marginTop: 12 }}>
          {location === null ? (
            <ActivityIndicator color={theme.inkSoft} />
          ) : (
            <ToggleRow
              theme={theme}
              title={t("onboarding.locationWhileUsing")}
              sub={permissionSub(location, {
                granted: t("onboarding.locationGrantedSub"),
                ask: t("onboarding.locationAskSub"),
                denied: t("onboarding.locationDeniedSub"),
              })}
              on={location.granted}
              onPress={location.granted ? undefined : onLocationPress}
            />
          )}
        </View>
      </View>

      {/* 02 · OFFLINE FALLBACK (illustration) */}
      <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={2}
            color={theme.stamp}
            title={t("onboarding.offlineFallback")}
            theme={theme}
          />
        </View>

        <View style={styles.offlineHero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <LinearGradient
            colors={[theme.inkDeep, "#2A332E"]}
            style={StyleSheet.absoluteFill}
          />
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 140"
            preserveAspectRatio="none"
            style={[StyleSheet.absoluteFill, { opacity: 0.1 }]}
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <Line
                key={`h${i}`}
                x1="0"
                x2="358"
                y1={i * 20}
                y2={i * 20}
                stroke={theme.paperSoft}
                strokeWidth="0.4"
              />
            ))}
            {Array.from({ length: 18 }).map((_, i) => (
              <Line
                key={`v${i}`}
                x1={i * 20}
                x2={i * 20}
                y1="0"
                y2="140"
                stroke={theme.paperSoft}
                strokeWidth="0.4"
              />
            ))}
          </Svg>

          {/* phone (you) */}
          <View
            style={[styles.offlinePhone, { backgroundColor: theme.stamp }]}
          >
            <Icon name="shield" size={24} color="#fff" />
          </View>
          <Text
            style={[
              styles.offlineLabelStart,
              { color: "rgba(255,255,255,0.65)" },
            ]}
          >
            {t("onboarding.offline")}
          </Text>

          {/* arc */}
          <View style={[styles.offlineArc, isRTL && { transform: [{ scaleX: -1 }] }]}>
            <Svg width="200" height="34" viewBox="0 0 200 34">
              <Path
                d="M0,17 Q100,-10 200,17"
                fill="none"
                stroke={theme.mustard}
                strokeWidth="1.6"
                strokeDasharray="5 4"
              />
              <Polygon points="194,15 200,17 194,23" fill={theme.mustard} />
            </Svg>
          </View>

          <View style={[styles.smsBadge, { backgroundColor: theme.mustard }]}>
            <Text style={[styles.smsBadgeText, { color: theme.inkDeep }]}>
              {t("onboarding.smsNoData")}
            </Text>
          </View>

          {/* contact */}
          <View
            style={[styles.offlineContact, { backgroundColor: theme.teal }]}
          >
            <Text style={styles.offlineContactInit}>{exampleContactName.charAt(0)}</Text>
          </View>
          <Text
            style={[
              styles.offlineLabelEnd,
              { color: "rgba(255,255,255,0.65)" },
            ]}
          >
            {exampleContactName}
          </Text>
        </View>

        <Text style={[styles.bodyCopy, { color: theme.inkSoft }]}>
          {t("onboarding.offlineBody")}
        </Text>
      </View>

      {/* 03 · TRUSTED CONTACTS */}
      <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={3}
            color={theme.mustard}
            title={t("onboarding.trustedThree", {
              count: selectedContacts.length,
            })}
            theme={theme}
          />
        </View>

        {/* Selected slots */}
        <View
          style={[
            styles.slotRow,
            {
              backgroundColor: theme.paperSoft,
              borderColor: theme.mustard,
            },
          ]}
        >
          {Array.from({ length: MAX_CONTACTS }, (_, slot) => {
            const c = selectedContacts[slot];
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
          <View style={{ flex: 1, marginStart: 4 }}>
            <Text
              numberOfLines={1}
              style={[styles.slotName, { color: theme.inkDeep }]}
            >
              {slotNames}
            </Text>
            <Text style={[styles.slotSub, { color: theme.inkSoft }]}>
              {t("onboarding.smsMissCheckIn")}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={pickContact}
            disabled={isFull || picking}
            accessibilityRole="button"
            accessibilityState={{ disabled: isFull || picking, busy: picking }}
            style={({ pressed }) => [
              styles.pickBtn,
              {
                backgroundColor: theme.paperSoft,
                borderColor: theme.mustard,
                opacity: isFull ? 0.5 : pressed ? 0.9 : 1,
              },
            ]}
          >
            {picking ? (
              <ActivityIndicator size="small" color={theme.mustard} />
            ) : (
              <Icon name="plus" size={16} color={theme.mustard} strokeWidth={2.4} />
            )}
            <Text style={[styles.pickBtnText, { color: theme.inkDeep }]}>
              {isFull
                ? t("onboarding.trustedThreeFull")
                : t("onboarding.chooseFromContacts")}
            </Text>
          </Pressable>
          {!isFull && !manualOpen && (
            <Pressable
              onPress={openManualEntry}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.pickBtn,
                {
                  backgroundColor: theme.paperSoft,
                  borderColor: theme.hairline,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Icon name="edit" size={15} color={theme.inkSoft} strokeWidth={2} />
              <Text style={[styles.pickBtnText, { color: theme.inkDeep }]}>
                {t("emergencyContacts.addManually")}
              </Text>
            </Pressable>
          )}
        </View>

        {manualOpen && !isFull && (
          <View
            style={[
              styles.manualCard,
              { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
            ]}
          >
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
              style={[styles.input, { color: theme.inkDeep, borderColor: theme.hairline, backgroundColor: theme.paper }]}
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
              style={[styles.input, { color: theme.inkDeep, borderColor: theme.hairline, backgroundColor: theme.paper }]}
            />
            {manualError && (
              <Text style={[styles.errorText, { color: theme.stamp }]} accessibilityLiveRegion="polite">
                {manualError}
              </Text>
            )}
            <View style={{ gap: 8, marginTop: 10 }}>
              <NomadButton theme={theme} variant="primary" onPress={saveManualContact}>
                {t("emergencyContacts.save")}
              </NomadButton>
              <NomadButton theme={theme} variant="ghost" onPress={() => setManualOpen(false)}>
                {t("common.cancel")}
              </NomadButton>
            </View>
          </View>
        )}

        {/* Selected contacts list */}
        {selectedContacts.length > 0 && (
          <View style={{ gap: 6, marginTop: 10 }}>
            {selectedContacts.map((c) => {
              const canSms = isValidPhone(c.phone);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => removeContact(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t("emergencyContacts.removeA11y", { name: c.name })}
                  style={[
                    styles.contactRow,
                    { backgroundColor: theme.paperSoft, borderColor: canSms ? theme.mustard : theme.stamp },
                  ]}
                >
                  <View
                    style={[
                      styles.contactAvatar,
                      { backgroundColor: hexFromName(theme, c.color) },
                    ]}
                  >
                    <Text style={styles.contactAvatarText}>{c.init}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.contactName, { color: theme.inkDeep }]}>
                      {c.name}
                    </Text>
                    <Text style={[styles.contactSub, { color: canSms ? theme.inkSoft : theme.stamp }]}>
                      {canSms ? c.phone : t("emergencyContacts.noPhoneWarning")}
                    </Text>
                  </View>
                  <Icon name="x" size={14} color={theme.inkMuted} strokeWidth={2.4} />
                </Pressable>
              );
            })}
          </View>
        )}

        {withPhone === 0 && (
          <View
            accessibilityRole="alert"
            style={[styles.warningRow, { backgroundColor: theme.stamp + "16", borderColor: theme.stamp }]}
          >
            <Icon name="alertTriangle" size={16} color={theme.stamp} strokeWidth={2} />
            <Text style={[styles.warningText, { color: theme.inkDeep }]}>
              {selectedContacts.length === 0
                ? t("onboarding.noContactsWarning")
                : t("emergencyContacts.noneWithPhone")}
            </Text>
          </View>
        )}
      </View>

      {/* 04 · CHECK-IN REMINDERS */}
      <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={4}
            color={theme.sky}
            title={t("onboarding.checkInReminders")}
            theme={theme}
          />
        </View>
        {notifications === null ? (
          <ActivityIndicator color={theme.inkSoft} />
        ) : (
          <ToggleRow
            theme={theme}
            title={t("onboarding.notificationsTitle")}
            sub={permissionSub(notifications, {
              granted: t("onboarding.notificationsGrantedSub"),
              ask: t("onboarding.notificationsAskSub"),
              denied: t("onboarding.notificationsDeniedSub"),
            })}
            on={notifications.granted}
            onPress={notifications.granted ? undefined : onNotificationsPress}
          />
        )}

        <Text style={[styles.bodyCopy, { color: theme.inkSoft, marginTop: 10 }]}>
          {t("onboarding.permissionNote")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.5,
    fontFamily: NOMAD_FONTS.ui,
  },
  bodyCopy: {
    fontSize: 12,
    marginTop: 8,
    paddingHorizontal: 10,
    lineHeight: 12 * 1.45,
    fontFamily: NOMAD_FONTS.ui,
  },
  caption: {
    fontSize: 11,
    marginTop: 6,
    paddingHorizontal: 10,
    fontStyle: "italic",
    fontFamily: NOMAD_FONTS.ui,
  },
  exampleTag: {
    position: "absolute",
    start: 18,
    bottom: 18,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  exampleTagText: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  slotRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 10,
  },
  slotEmpty: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  slotFilled: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  slotInit: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 13,
  },
  slotName: {
    fontSize: 11.5,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  slotSub: {
    fontSize: 10,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
  pickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  pickBtnText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
    flexShrink: 1,
  },
  manualCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
    marginBottom: 4,
  },
  input: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 14,
    fontFamily: NOMAD_FONTS.ui,
  },
  errorText: {
    fontSize: 12,
    marginTop: 8,
    fontFamily: NOMAD_FONTS.ui,
  },
  contactRow: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
  },
  contactAvatar: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 12,
  },
  contactName: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  contactSub: {
    fontSize: 10.5,
    fontFamily: NOMAD_FONTS.ui,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 12 * 1.4,
    fontFamily: NOMAD_FONTS.ui,
  },
  offlineHero: {
    height: 140,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
  },
  offlinePhone: {
    position: "absolute",
    start: 20,
    top: 34,
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#C6432A",
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  offlineLabelStart: {
    position: "absolute",
    start: 20,
    top: 98,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "700",
    width: 58,
    textAlign: "center",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  offlineArc: {
    position: "absolute",
    start: 76,
    top: 50,
  },
  smsBadge: {
    position: "absolute",
    start: 132,
    top: 22,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  smsBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  offlineContact: {
    position: "absolute",
    end: 20,
    top: 34,
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2B6C5F",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  offlineContactInit: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 22,
  },
  offlineLabelEnd: {
    position: "absolute",
    end: 20,
    top: 98,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "700",
    textAlign: "center",
    width: 58,
    fontFamily: NOMAD_FONTS.uiBold,
  },
});
