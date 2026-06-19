import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import Svg, { Line, Path, Polygon } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import * as Contacts from "expo-contacts";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { NomadCard } from "@/components/nomad/Card";
import { TravelMap } from "@/components/nomad/TravelMap";
import { Icon } from "@/components/nomad/Icon";
import { PermissionRow } from "@/components/nomad/PermissionRow";
import {
  Eyebrow,
  HugeHeadline,
  HeadlineItalic,
  SectionLabel,
} from "@/components/nomad/Typography";
import {
  permissionsService,
  type PermissionKind,
} from "@/features/onboarding/services/permissions";
import {
  emergencyContactsStorage,
  type EmergencyContact,
} from "@/features/onboarding/services/emergencyContactsStorage";

interface Props {
  theme: NomadTheme;
  dark: boolean;
  totalSteps: number;
  onPermissionsReady?: (ready: boolean) => void;
}

interface PermissionState {
  locationGranted: boolean;
  contactsGranted: boolean;
  smsGranted: boolean;
  loading: boolean;
}

interface SelectableContact extends EmergencyContact {
  init: string;
  color: string;
}

const FALLBACK_CONTACTS: SelectableContact[] = [
  { id: "mum", name: "Mum", phone: null, init: "M", color: "teal" },
  { id: "dad", name: "Dad", phone: null, init: "D", color: "stamp" },
];

function hexFromName(
  theme: NomadTheme,
  name: string,
): string {
  return (theme[name as keyof NomadTheme] as string) ?? theme.inkDeep;
}

export function SafetyStep({
  theme,
  dark,
  totalSteps,
  onPermissionsReady,
}: Props) {
  const { t } = useLocalization();

  const [permissions, setPermissions] = useState<PermissionState>({
    locationGranted: false,
    contactsGranted: false,
    smsGranted: true,
    loading: true,
  });

  const [selectedContacts, setSelectedContacts] = useState<SelectableContact[]>([]);
  const [deviceContacts, setDeviceContacts] = useState<SelectableContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [initialChecked, setInitialChecked] = useState(false);

  const getLocationSub = () => {
    if (permissions.locationGranted) return t("onboarding.sosSharingGeofences");
    return t("onboarding.locationAlwaysSub");
  };

  const getContactsSub = () => {
    if (permissions.contactsGranted) return t("onboarding.pickYourThreeOffline");
    return t("onboarding.contactsPermissionSub");
  };

  const getSmsSub = () => {
    if (permissions.smsGranted) return t("onboarding.pickYourThreeOffline");
    return t("onboarding.smsPermissionSub");
  };

  const loadContacts = React.useCallback(async () => {
    setLoadingContacts(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        pageSize: 100,
      });
      const mapped: SelectableContact[] = data
        .filter((c) => c.name)
        .slice(0, 30)
        .map((c, i) => ({
          id: c.id,
          name: c.name,
          phone: c.phoneNumbers?.[0]?.number ?? null,
          init: c.name.charAt(0).toUpperCase(),
          color: ["teal", "mustard", "sky", "stamp"][i % 4],
        }));
      setDeviceContacts(mapped.length ? mapped : FALLBACK_CONTACTS);
    } catch {
      setDeviceContacts(FALLBACK_CONTACTS);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (initialChecked) return;
      const status = await permissionsService.checkAll();
      if (!mounted) return;
      setPermissions({
        locationGranted: status.location.granted,
        contactsGranted: status.contacts.granted,
        smsGranted: status.sms.granted,
        loading: false,
      });
      if (status.contacts.granted && deviceContacts.length === 0) {
        await loadContacts();
      }
      setInitialChecked(true);
    };
    run();
    return () => {
      mounted = false;
    };
  }, [deviceContacts.length, initialChecked, loadContacts]);

  useEffect(() => {
    const ready =
      permissions.locationGranted &&
      permissions.contactsGranted &&
      selectedContacts.length > 0;
    onPermissionsReady?.(ready);
    if (ready) {
      emergencyContactsStorage.set(
        selectedContacts.map(({ id, name, phone }) => ({ id, name, phone })),
      );
    }
  }, [permissions, selectedContacts, onPermissionsReady]);

  const requestPermission = async (kind: PermissionKind) => {
    try {
      if (kind === "location" || kind === "locationAlways") {
        const status = await permissionsService.requestLocation();
        setPermissions((p) => ({
          ...p,
          locationGranted: status.granted,
        }));
        if (!status.granted && !status.canAskAgain) {
          Alert.alert(
            t("onboarding.locationRequiredTitle"),
            t("onboarding.locationRequiredBody"),
          );
        }
      } else if (kind === "contacts") {
        const status = await permissionsService.requestContacts();
        setPermissions((p) => ({ ...p, contactsGranted: status.granted }));
        if (status.granted) {
          await loadContacts();
        } else if (!status.canAskAgain) {
          Alert.alert(
            t("onboarding.contactsRequiredTitle"),
            t("onboarding.contactsRequiredBody"),
          );
        }
      } else if (kind === "sms") {
        const status = await permissionsService.requestSms();
        setPermissions((p) => ({ ...p, smsGranted: status.granted }));
      }
    } catch {
      // ignore
    }
  };

  const toggleContact = (contact: SelectableContact) => {
    setSelectedContacts((prev) => {
      const exists = prev.find((c) => c.id === contact.id);
      if (exists) {
        return prev.filter((c) => c.id !== contact.id);
      }
      if (prev.length >= 3) return prev;
      return [...prev, contact];
    });
  };

  const resolvedContacts = deviceContacts.length
    ? deviceContacts
    : FALLBACK_CONTACTS;

  const slotNames =
    selectedContacts.map((c) => c.name).join(" · ") ||
    t("onboarding.pickUpToThree");

  const mapPins = [
    { x: 110, y: 120, color: theme.stamp, pulse: true },
    { x: 220, y: 85, color: theme.teal },
    { x: 280, y: 160, color: theme.mustard },
  ];

  return (
    <View style={{ flex: 1 }}>
      {/* Headline */}
      <View style={{ paddingHorizontal: 26, paddingTop: 6, paddingBottom: 18 }}>
        <Eyebrow color={theme.teal}>
          {t("onboarding.stepOf", { step: 1, total: totalSteps - 1 })}
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
            title={t("onboarding.liveLocation")}
            theme={theme}
          />
        </View>
        <NomadCard
          theme={theme}
          padding={10}
          style={{ position: "relative", overflow: "hidden" }}
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
          <View
            style={{
              position: "absolute",
              left: 18,
              bottom: 18,
              right: 18,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <View
              style={[
                styles.gpsPill,
                { backgroundColor: "rgba(26,22,18,0.88)" },
              ]}
            >
              <Text style={[styles.gpsPillText, { color: theme.paperSoft }]}>
                {t("onboarding.gpsStatus")}
              </Text>
            </View>
            <View style={[styles.livePill, { backgroundColor: theme.tealSoft }]}>
              <Text style={[styles.livePillText, { color: theme.teal }]}>
                {t("onboarding.live")}
              </Text>
            </View>
          </View>
        </NomadCard>
        <Text style={[styles.bodyCopy, { color: theme.inkSoft }]}>
          {t("onboarding.locationBody")}
        </Text>
      </View>

      {/* 02 · TRUSTED THREE */}
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={2}
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
          {[0, 1, 2].map((slot) => {
            const c = selectedContacts[slot];
            if (!c) {
              return (
                <View
                  key={slot}
                  style={[styles.slotEmpty, { borderColor: theme.hairline }]}
                >
                  <Text style={{ color: theme.inkMuted, fontSize: 16 }}>+</Text>
                </View>
              );
            }
            return (
              <View
                key={slot}
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
          <View style={{ flex: 1, marginLeft: 4 }}>
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

        {/* Loading state */}
        {permissions.contactsGranted && loadingContacts && (
          <View style={[styles.loadingRow, { borderColor: theme.hairline }]}>
            <ActivityIndicator size="small" color={theme.mustard} />
            <Text style={[styles.loadingText, { color: theme.inkSoft }]}>
              {t("onboarding.loadingContacts")}
            </Text>
          </View>
        )}

        {/* Device contact list */}
        <View style={{ gap: 6 }}>
          {resolvedContacts.map((c) => {
            const on = selectedContacts.some((s) => s.id === c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() => toggleContact(c)}
                style={[
                  styles.contactRow,
                  {
                    backgroundColor: on ? theme.paperSoft : "transparent",
                    borderColor: on ? theme.mustard : theme.hairline,
                  },
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
                  <Text style={[styles.contactSub, { color: theme.inkSoft }]}>
                    {c.phone ?? t("onboarding.noPhone")}
                  </Text>
                </View>
                <View
                  style={[
                    styles.checkBox,
                    {
                      borderColor: on ? theme.mustard : theme.hairline,
                      backgroundColor: on ? theme.mustard : "transparent",
                    },
                  ]}
                >
                  {on ? (
                    <Icon name="check" size={10} color="#fff" strokeWidth={3} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 03 · OFFLINE FALLBACK */}
      <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={3}
            color={theme.stamp}
            title={t("onboarding.offlineFallback")}
            theme={theme}
          />
        </View>

        <View style={styles.offlineHero}>
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
              styles.offlineLabelLeft,
              { color: "rgba(255,255,255,0.65)" },
            ]}
          >
            {t("onboarding.offline")}
          </Text>

          {/* arc */}
          <View style={styles.offlineArc}>
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
            <Text style={styles.offlineContactInit}>M</Text>
          </View>
          <Text
            style={[
              styles.offlineLabelRight,
              { color: "rgba(255,255,255,0.65)" },
            ]}
          >
            {t("onboarding.mumUpper")}
          </Text>
        </View>

        <Text style={[styles.bodyCopy, { color: theme.inkSoft }]}>
          {t("onboarding.offlineBody")}
        </Text>
      </View>

      {/* Consolidated permissions */}
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={4}
            color={theme.sky}
            title={t("onboarding.permissions")}
            theme={theme}
          />
        </View>
        <View style={{ gap: 6 }}>
          {permissions.loading ? (
            <ActivityIndicator color={theme.inkSoft} />
          ) : (
            <>
              <PermissionRow
                theme={theme}
                title={t("onboarding.locationAlways")}
                sub={getLocationSub()}
                on={permissions.locationGranted}
                onPress={() => requestPermission("locationAlways")}
              />
              <PermissionRow
                theme={theme}
                title={t("onboarding.contacts")}
                sub={getContactsSub()}
                on={permissions.contactsGranted}
                onPress={() => requestPermission("contacts")}
              />
              {Platform.OS === "android" && (
                <PermissionRow
                  theme={theme}
                  title={t("onboarding.sms")}
                  sub={getSmsSub()}
                  on={permissions.smsGranted}
                  onPress={() => requestPermission("sms")}
                />
              )}
            </>
          )}
        </View>
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
  gpsPill: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  gpsPillText: {
    fontSize: 9.5,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.5,
  },
  livePill: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  livePillText: {
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
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 8,
  },
  loadingText: {
    fontSize: 13,
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
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  offlineHero: {
    height: 140,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
  },
  offlinePhone: {
    position: "absolute",
    left: 20,
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
  offlineLabelLeft: {
    position: "absolute",
    left: 20,
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
    left: 76,
    top: 50,
  },
  smsBadge: {
    position: "absolute",
    left: 132,
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
    right: 20,
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
  offlineLabelRight: {
    position: "absolute",
    right: 20,
    top: 98,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "700",
    textAlign: "center",
    width: 58,
    fontFamily: NOMAD_FONTS.uiBold,
  },
});
