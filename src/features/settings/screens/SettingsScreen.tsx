import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { Avatar } from "@/components/ui/Avatar";
import Animated, { useSharedValue, withSpring, useAnimatedStyle } from "react-native-reanimated";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { Screen } from "@/components/layout/Screen";
import { NomadCard } from "@/components/nomad/Card";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { authClient, localAuth, useAuthStore } from "@/features/auth";
import { useAiModels } from "@/features/ai";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useSettingsStore } from "@/features/settings";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { smsFallbackStorage, type SmsTemplatePurpose } from "@/features/safety/services/smsFallbackStorage";
import { exportEverything } from "@/features/settings/services/exportService";
import { wipeAllDeviceData } from "@/features/settings/services/wipeService";

const CHECK_IN_OPTIONS = [
  { seconds: 15 * 60, label: "15 min" },
  { seconds: 30 * 60, label: "30 min" },
  { seconds: 60 * 60, label: "1 hr" },
  { seconds: 2 * 60 * 60, label: "2 hr" },
  { seconds: 4 * 60 * 60, label: "4 hr" },
  { seconds: 8 * 60 * 60, label: "8 hr" },
];

function formatShortDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m === 0) return `${h} hr`;
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

function formatMemberSince(dateString?: string, locale = "en"): string {
  if (!dateString) return "recently";
  const date = new Date(dateString);
  try {
    return date.toLocaleDateString(locale, { month: "short", year: "numeric" });
  } catch {
    return date.toLocaleDateString("en", { month: "short", year: "numeric" });
  }
}

function computeStampCount(trips: { destinations: string[] }[], expensesCount: number): number {
  const destinationCount = trips.reduce((sum, t) => sum + (t.destinations?.length ?? 0), 0);
  return Math.max(0, destinationCount + Math.floor(expensesCount / 3));
}

function Toggle({
  value,
  onValueChange,
  disabled,
  theme,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
}) {
  const offset = useSharedValue(value ? 18 : 2);

  useEffect(() => {
    offset.value = withSpring(value ? 18 : 2, { damping: 15, stiffness: 150 });
  }, [offset, value]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      disabled={disabled}
      style={[
        styles.toggleTrack,
        {
          backgroundColor: value ? theme.teal : theme.hairline,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.toggleThumb,
          { backgroundColor: theme.inverse },
          animatedStyle,
        ]}
      />
    </Pressable>
  );
}

function SectionLabel({ label, theme }: { label: string; theme: ReturnType<typeof useTheme>["nomad"]["colors"] }) {
  return (
    <Text
      style={[
        styles.sectionLabel,
        { color: theme.inkMuted, fontFamily: NOMAD_FONTS.uiBold },
      ]}
    >
      {label}
    </Text>
  );
}

function SettingRow({
  icon,
  tint,
  iconColor,
  title,
  sub,
  right,
  onPress,
  theme,
}: {
  icon: IconName;
  tint: string;
  iconColor: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
}) {
  const content = (
    <NomadCard theme={theme} padding={14} style={styles.rowCard}>
      <View style={[styles.iconMark, { backgroundColor: tint }]}>
        <Icon name={icon} size={18} color={iconColor} strokeWidth={1.8} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: theme.inkDeep }]}>{title}</Text>
        {sub ? (
          <Text style={[styles.rowSub, { color: theme.inkSoft }]}>{sub}</Text>
        ) : null}
      </View>
      {right}
    </NomadCard>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        {content}
      </Pressable>
    );
  }

  return content;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();

  const user = useAuthStore((s) => s.user);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const signOut = useAuthStore((s) => s.signOut);

  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const tripModeEnabled = useSettingsStore((s) => s.tripModeEnabled);
  const setTripModeEnabled = useSettingsStore((s) => s.setTripModeEnabled);
  const defaultCheckInDuration = useSettingsStore((s) => s.defaultCheckInDuration);
  const setDefaultCheckInDuration = useSettingsStore((s) => s.setDefaultCheckInDuration);
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const setLocalAiEnabled = useSettingsStore((s) => s.setLocalAiEnabled);

  const trips = useTripsStore((s) => s.trips);
  const activeTripId = useTripsStore((s) => s.activeTripId);
  const expenses = useExpensesStore((s) => s.expenses);
  const { capability } = useAiModels();

  const [contacts, setContacts] = useState(() => emergencyContactsStorage.get());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [smsModalVisible, setSmsModalVisible] = useState(false);
  const [activeSmsPurpose, setActiveSmsPurpose] = useState<SmsTemplatePurpose>("missedCheckIn");
  const [smsDraft, setSmsDraft] = useState("");

  const activeTrip = useMemo(
    () => trips.find((t) => t.id === activeTripId) ?? null,
    [trips, activeTripId],
  );
  // activeTrip intentionally kept for future trip-aware settings
  void activeTrip;

  useEffect(() => {
    let mounted = true;
    localAuth
      .checkBiometricAvailability()
      .then(({ available }) => {
        if (mounted) setBiometricAvailable(available);
      })
      .catch(() => {
        if (mounted) setBiometricAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setContacts(emergencyContactsStorage.get());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const name = user?.name ?? t("common.fallbackUser");
  const initial = name.trim()[0]?.toUpperCase() ?? "N";
  const avatarUri = user?.avatarUrl;
  const tripCount = trips.length;
  const stampCount = computeStampCount(trips, expenses.length);
  const sinceText =
    trips.length > 0
      ? formatMemberSince(
          trips.reduce((earliest, trip) =>
            !earliest || trip.createdAt < earliest ? trip.createdAt : earliest,
            undefined as string | undefined,
          ),
          locale,
        )
      : t("settings.profileSince", { date: formatMemberSince(new Date().toISOString(), locale) });

  const contactSub =
    contacts.length > 0
      ? t("settings.emergencyContactsSub", {
          count: contacts.length,
          names: contacts.map((c) => c.name).join(", ") || "",
        })
      : t("settings.emergencyContactsEmpty");

  const toggleBiometric = async (value: boolean) => {
    if (!value) {
      setBiometricEnabled(false);
      return;
    }

    if (!biometricAvailable) {
      Alert.alert(t("settings.biometricNotSetUpTitle"), t("settings.biometricNotSetUpBody"));
      return;
    }

    if (!isPinSet) {
      Alert.alert(t("settings.setPinFirstTitle"), t("settings.setPinFirstBody"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.continue"),
          onPress: () => router.push("/(auth)/setup-pin"),
        },
      ]);
      return;
    }

    setBiometricEnabled(true);
  };

  const handleDefaultCheckIn = (seconds: number) => {
    setDefaultCheckInDuration(seconds);
  };

  const handleSmsFallback = (purpose: SmsTemplatePurpose) => {
    setActiveSmsPurpose(purpose);
    setSmsDraft(smsFallbackStorage.get(purpose));
    setSmsModalVisible(true);
  };

  const saveSmsTemplate = () => {
    smsFallbackStorage.set(activeSmsPurpose, smsDraft);
    setSmsModalVisible(false);
  };

  const handleExport = () => {
    Alert.alert(t("settings.exportEverything"), t("settings.exportEverythingSub"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.continue"),
        onPress: async () => {
          setExporting(true);
          try {
            await exportEverything();
            Alert.alert(t("settings.exportSuccessTitle"), t("settings.exportSuccessBody"));
          } finally {
            setExporting(false);
          }
        },
      },
    ]);
  };

  const handleWipe = () => {
    Alert.alert(t("settings.wipeConfirmTitle"), t("settings.wipeConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          if (biometricAvailable) {
            const ok = await localAuth.authenticateWithBiometric({
              promptMessage: t("settings.wipeAuthTitle"),
              cancelLabel: t("common.cancel"),
            });
            if (!ok) return;
          }
          setWiping(true);
          try {
            await wipeAllDeviceData();
            router.replace("/(onboarding)/welcome");
          } finally {
            setWiping(false);
          }
        },
      },
    ]);
  };

  const handleSignOut = () => {
    Alert.alert(t("settings.signOutTitle"), t("settings.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.signOut"),
        style: "destructive",
        onPress: async () => {
          try {
            await authClient.signOut();
          } catch {
            // ignore
          }
          signOut();
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  };

  return (
    <Screen scroll edges={["top"]}>
      {/* Title */}
      <View style={styles.titleBlock}>
        <Text style={[styles.subtitle, { color: theme.inkMuted, fontFamily: NOMAD_FONTS.uiBold }]}>
          {t("settings.subtitle")}
        </Text>
        <Text style={[styles.title, { color: theme.inkDeep, fontFamily: NOMAD_FONTS.display }]}>
          {t("settings.title")}
        </Text>
      </View>

      {/* Profile stamp */}
      <NomadCard theme={theme} padding={16}>
        <View style={styles.profileRow}>
          {avatarUri ? (
            <Avatar name={name} imageUri={avatarUri} size={58} />
          ) : (
            <LinearGradient
              colors={[theme.mustard, theme.stamp]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatar}
            >
              <Text style={[styles.avatarText, { color: theme.inverse }]}>{initial}</Text>
            </LinearGradient>
          )}
          <View style={styles.profileText}>
            <Text style={[styles.profileName, { color: theme.inkDeep, fontFamily: NOMAD_FONTS.display }]}>
              {name}
            </Text>
            <Text style={[styles.profileMeta, { color: theme.inkSoft }]}>
              {t("settings.profileTrips", { count: tripCount })} · {" "}
              {t("settings.profileStamps", { count: stampCount })} · {" "}
              {sinceText}
            </Text>
          </View>
          <View
            style={[
              styles.premiumBadge,
              { backgroundColor: localAiEnabled ? theme.tealSoft : theme.hairline },
            ]}
          >
            <Text
              style={[
                styles.premiumBadgeText,
                { color: localAiEnabled ? theme.teal : theme.inkMuted },
              ]}
            >
              {localAiEnabled ? t("settings.premiumBadge") : t("settings.freeBadge")}
            </Text>
          </View>
        </View>
      </NomadCard>

      <View style={styles.section}>
        <SectionLabel label={t("settings.privacySection")} theme={theme} />
        <SettingRow
          icon="faceId"
          tint={theme.tealSoft}
          iconColor={theme.teal}
          title={t("settings.faceIdVault")}
          sub={t("settings.faceIdVaultSub")}
          theme={theme}
          right={
            <Toggle
              value={biometricEnabled}
              onValueChange={toggleBiometric}
              disabled={!biometricAvailable && !biometricEnabled}
              theme={theme}
            />
          }
        />
      </View>

      <View style={styles.section}>
        <SectionLabel label={t("settings.safetySection")} theme={theme} />
        <SettingRow
          icon="bell"
          tint={theme.mustardSoft}
          iconColor={theme.mustard}
          title={t("settings.emergencyContacts")}
          sub={contactSub}
          theme={theme}
          right={<Icon name="chevronRight" size={16} color={theme.inkMuted} strokeWidth={1.8} />}
          onPress={() => router.push("/emergency-contacts")}
        />
        <SettingRow
          icon="clock"
          tint={theme.tealSoft}
          iconColor={theme.teal}
          title={t("settings.defaultCheckIn")}
          sub={t("settings.defaultCheckInSub", {
            duration: formatShortDuration(defaultCheckInDuration),
          })}
          theme={theme}
          right={
            <View style={styles.optionRow}>
              {CHECK_IN_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.seconds}
                  onPress={() => handleDefaultCheckIn(opt.seconds)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        defaultCheckInDuration === opt.seconds ? theme.teal : theme.paperSoft,
                      borderColor: defaultCheckInDuration === opt.seconds ? theme.teal : theme.hairline,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: defaultCheckInDuration === opt.seconds ? theme.inverse : theme.inkDeep,
                        fontFamily: NOMAD_FONTS.uiSemi,
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />
        <SettingRow
          icon="phone"
          tint={theme.stampSoft}
          iconColor={theme.stamp}
          title={t("settings.smsFallback")}
          sub={t("settings.smsFallbackSub")}
          theme={theme}
          right={<Icon name="chevronRight" size={16} color={theme.inkMuted} strokeWidth={1.8} />}
          onPress={() => handleSmsFallback("missedCheckIn")}
        />
      </View>

      <View style={styles.section}>
        <SectionLabel label={t("settings.appearanceSection")} theme={theme} />
        <SettingRow
          icon="sparkle"
          tint={theme.skySoft}
          iconColor={theme.sky}
          title={t("settings.darkMode")}
          sub={t("settings.darkModeSub")}
          theme={theme}
          right={
            <View style={styles.optionRow}>
              {[
                { value: "light" as const, label: t("settings.themeLight") },
                { value: "dark" as const, label: t("settings.themeDark") },
                { value: "system" as const, label: t("settings.themeSystem") },
              ].map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setThemeMode(opt.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        themeMode === opt.value ? theme.stamp : theme.paperSoft,
                      borderColor:
                        themeMode === opt.value ? theme.stamp : theme.hairline,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: themeMode === opt.value ? theme.inverse : theme.inkDeep,
                        fontFamily: NOMAD_FONTS.uiSemi,
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />
      </View>

      <View style={styles.section}>
        <SectionLabel label={t("settings.appearanceSection")} theme={theme} />
        <SettingRow
          icon="flag"
          tint={theme.mustardSoft}
          iconColor={theme.mustard}
          title={t("settings.tripMode")}
          sub={tripModeEnabled ? t("settings.tripModeSub") : t("settings.tripModeOffSub")}
          theme={theme}
          right={
            <Toggle value={tripModeEnabled} onValueChange={setTripModeEnabled} theme={theme} />
          }
        />
      </View>

      <View style={styles.section}>
        <SectionLabel label={t("settings.premiumSection")} theme={theme} />
        <SettingRow
          icon="sparkle"
          tint={theme.tealSoft}
          iconColor={theme.teal}
          title={t("settings.localAi")}
          sub={localAiEnabled ? t("settings.localAiSub") : t("settings.localAiDisabled")}
          theme={theme}
          right={
            <Toggle
              value={localAiEnabled}
              onValueChange={setLocalAiEnabled}
              disabled={!capability?.supported}
              theme={theme}
            />
          }
        />
      </View>

      <View style={styles.section}>
        <SectionLabel label={t("settings.dataSection")} theme={theme} />
        <SettingRow
          icon="send"
          tint={theme.paperSoft}
          iconColor={theme.inkSoft}
          title={t("settings.exportEverything")}
          sub={t("settings.exportEverythingSub")}
          theme={theme}
          right={exporting ? <ActivityIndicator color={theme.teal} /> : <Icon name="chevronRight" size={16} color={theme.inkMuted} strokeWidth={1.8} />}
          onPress={handleExport}
        />
        <SettingRow
          icon="trash"
          tint={theme.stampSoft}
          iconColor={theme.stamp}
          title={t("settings.wipeDeviceData")}
          sub={t("settings.wipeDeviceDataSub")}
          theme={theme}
          right={wiping ? <ActivityIndicator color={theme.stamp} /> : <Icon name="chevronRight" size={16} color={theme.stamp} strokeWidth={1.8} />}
          onPress={handleWipe}
        />
      </View>

      <View style={styles.section}>
        <SectionLabel label={t("settings.accountSection")} theme={theme} />
        <SettingRow
          icon="phone"
          tint={theme.stampSoft}
          iconColor={theme.stamp}
          title={t("settings.signOut")}
          sub={user?.email ?? user?.phone ?? ""}
          theme={theme}
          right={<Icon name="chevronRight" size={16} color={theme.inkMuted} strokeWidth={1.8} />}
          onPress={handleSignOut}
        />
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.footerQuote, { color: theme.inkMuted, fontFamily: NOMAD_FONTS.displayItalic }]}>
          {`“${t("settings.footerTagline")}”`}
        </Text>
        <Text style={[styles.footerVersion, { color: theme.inkMuted, fontFamily: NOMAD_FONTS.monoMedium }]}>
          v{Constants.expoConfig?.version ?? "1.0.0"} · build {Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? "2026.04"}
        </Text>
      </View>

      <Modal
        visible={smsModalVisible}
        onClose={() => setSmsModalVisible(false)}
        title={t("settings.smsTemplateTitle")}
        actions={[
          { title: t("common.cancel"), variant: "ghost", onPress: () => setSmsModalVisible(false) },
          { title: t("common.ok"), variant: "primary", onPress: saveSmsTemplate },
        ]}
      >
        <Text style={{ color: theme.inkSoft, fontFamily: NOMAD_FONTS.ui, fontSize: 13, marginBottom: 16 }}>
          {t("settings.smsTemplateBody")}
        </Text>

        <View style={styles.smsTabs}>
          {(
            [
              { purpose: "missedCheckIn" as const, label: t("settings.smsMissedCheckIn"), icon: "clock" as const },
              { purpose: "sos" as const, label: t("settings.smsSos"), icon: "alertTriangle" as const },
              { purpose: "invite" as const, label: t("settings.smsInvite"), icon: "mail" as const },
              { purpose: "other" as const, label: t("settings.smsOther"), icon: "messageCircle" as const },
            ] as const
          ).map((opt) => {
            const active = activeSmsPurpose === opt.purpose;
            return (
              <Pressable
                key={opt.purpose}
                onPress={() => {
                  setActiveSmsPurpose(opt.purpose);
                  setSmsDraft(smsFallbackStorage.get(opt.purpose));
                }}
                style={[
                  styles.smsTab,
                  {
                    backgroundColor: active ? theme.stampSoft : theme.paper,
                    borderColor: active ? theme.stamp : theme.hairline,
                  },
                ]}
              >
                <Icon name={opt.icon} size={14} color={active ? theme.stamp : theme.inkMuted} strokeWidth={2} />
                <Text
                  style={[
                    styles.smsTabText,
                    {
                      color: active ? theme.stamp : theme.inkDeep,
                      fontFamily: active ? NOMAD_FONTS.uiSemi : NOMAD_FONTS.ui,
                    },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <NomadCard theme={theme} padding={12} style={styles.smsEditorCard}>
          <Input
            value={smsDraft}
            onChangeText={setSmsDraft}
            placeholder={t("settings.smsTemplatePlaceholder")}
            autoCapitalize="sentences"
            multiline
            numberOfLines={5}
          />
          <View style={styles.smsMetaRow}>
            <Text style={[styles.smsMeta, { color: theme.inkMuted, fontFamily: NOMAD_FONTS.ui }]}>
              {smsDraft.length} {smsDraft.length === 1 ? "char" : "chars"}
            </Text>
            <Text style={[styles.smsMeta, { color: theme.inkMuted, fontFamily: NOMAD_FONTS.ui }]}>
              {Math.ceil(smsDraft.length / 160)} SMS
            </Text>
          </View>
        </NomadCard>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    marginTop: 8,
    marginBottom: 18,
  },
  subtitle: {
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    fontSize: 38,
    lineHeight: 40,
    letterSpacing: -0.8,
  },
  section: {
    marginTop: 22,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 2,
    marginLeft: 10,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  rowSub: {
    fontSize: 11.5,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: 999,
    justifyContent: "center",
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  optionRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    maxWidth: 180,
  },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 26,
    fontStyle: "italic",
    fontWeight: "500",
    fontFamily: NOMAD_FONTS.displayItalic,
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    fontSize: 24,
    lineHeight: 26,
  },
  profileMeta: {
    fontSize: 12,
    marginTop: 4,
    fontFamily: NOMAD_FONTS.ui,
  },
  premiumBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  premiumBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  footer: {
    marginTop: 28,
    marginBottom: 40,
    alignItems: "center",
  },
  footerQuote: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
  },
  footerVersion: {
    fontSize: 11,
    marginTop: 8,
  },
  smsTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  smsTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  smsTabText: {
    fontSize: 12,
    fontWeight: "600",
  },
  smsEditorCard: {
    gap: 8,
  },
  smsMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  smsMeta: {
    fontSize: 11,
  },
});
