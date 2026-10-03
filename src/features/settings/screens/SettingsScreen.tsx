import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { AuraListGroup, AuraListRow } from "@/components/aura/AuraList";
import { AuraSwitch } from "@/components/aura/AuraSwitch";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { LEGAL_URLS } from "@/constants/legal";
import { LANGUAGE_OPTIONS, useLocalization, type SupportedLocale } from "@/localization";
import { confirmDeviceOwner, disconnectGmail, signOutAndCleanup } from "@/services/session";
import { disableBackup, flushGroupSync, flushSync, hasBackupOwner } from "@/features/sync";
import { localAuth, useAuthStore, useBiometricPresentation } from "@/features/auth";
import { useProvisioningStore } from "@/features/ai";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { hasGmailGrant, hydrateGmailConnection, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";
import { ensureGmailAccountEmail } from "@/features/expenses/services/gmailAuth";
import { useSettingsStore } from "@/features/settings";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { exportEverything } from "@/features/settings/services/exportService";
import { wipeAllDeviceData } from "@/features/settings/services/wipeService";
import { SettingsOptionSheet } from "@/features/settings/components/SettingsOptionSheet";
import { SettingsProfileHeader } from "@/features/settings/components/SettingsProfileHeader";
import { SmsTemplatesSheet } from "@/features/settings/components/SmsTemplatesSheet";

const CHECK_IN_OPTIONS = [15 * 60, 30 * 60, 60 * 60, 2 * 60 * 60, 4 * 60 * 60, 8 * 60 * 60];
const AUTO_LOCK_OPTIONS = [0, 60_000, 5 * 60_000, 15 * 60_000];
const DANGER = auraStatusAccent.alert;
const [INDIGO, TEAL, VIOLET] = auraStatusColors.calm;
const AMBER = auraStatusAccent.live;

type ThemeMode = "light" | "dark" | "system";
type SheetId = "autoLock" | "checkIn" | "appearance" | "language" | "sms";
type Translate = ReturnType<typeof useLocalization>["t"];

function formatShortDuration(seconds: number, t: Translate): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m === 0) return t("settings.durationHours", { count: h });
  if (h > 0) return t("settings.durationHoursMinutes", { hours: h, minutes: m });
  return t("settings.durationMinutes", { count: m });
}

function formatAutoLock(ms: number, t: Translate): string {
  return ms === 0 ? t("settings.autoLockImmediately") : formatShortDuration(ms / 1000, t);
}

function formatMonthYear(dateString: string, locale: string): string {
  const date = new Date(dateString);
  try {
    return date.toLocaleDateString(locale, { month: "short", year: "numeric" });
  } catch {
    return date.toLocaleDateString("en", { month: "short", year: "numeric" });
  }
}

function nativeLanguageName(locale: SupportedLocale): string {
  return LANGUAGE_OPTIONS.find((option) => option.locale === locale)?.nativeLabel ?? locale;
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, f, isDark } = useAura();
  const { t, locale, deviceLocale } = useLocalization();

  const user = useAuthStore((s) => s.user);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const autoLockTimeout = useAuthStore((s) => s.autoLockTimeout);
  const setAutoLockTimeout = useAuthStore((s) => s.setAutoLockTimeout);
  const deleteAccount = useMutation(api.account.deleteAccount);
  const biometric = useBiometricPresentation();

  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const localeOverride = useSettingsStore((s) => s.localeOverride);
  const setLocaleOverride = useSettingsStore((s) => s.setLocaleOverride);
  const tripModeEnabled = useSettingsStore((s) => s.tripModeEnabled);
  const setTripModeEnabled = useSettingsStore((s) => s.setTripModeEnabled);
  const defaultCheckInDuration = useSettingsStore((s) => s.defaultCheckInDuration);
  const setDefaultCheckInDuration = useSettingsStore((s) => s.setDefaultCheckInDuration);
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const setLocalAiEnabled = useSettingsStore((s) => s.setLocalAiEnabled);
  const analyticsEnabled = useSettingsStore((s) => s.analyticsEnabled);
  const setAnalyticsEnabled = useSettingsStore((s) => s.setAnalyticsEnabled);
  const cloudBackupEnabled = useSettingsStore((s) => s.cloudBackupEnabled);
  const setCloudBackupEnabled = useSettingsStore((s) => s.setCloudBackupEnabled);

  const trips = useTripsStore((s) => s.trips);
  const aiDeviceSupported = useProvisioningStore((s) => s.deviceSupported);
  const gmailTokens = useGmailConnectionStore((s) => s.tokens);
  const gmailConnected = hasGmailGrant(gmailTokens);
  const gmailEmail = gmailTokens?.email;

  const [contacts, setContacts] = useState(() => emergencyContactsStorage.get());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const closeSheet = () => setSheet(null);

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

  useFocusEffect(
    useCallback(() => {
      setContacts(emergencyContactsStorage.get());
      void hydrateGmailConnection().then(ensureGmailAccountEmail);
    }, []),
  );

  const name = user?.name ?? t("common.fallbackUser");
  const earliestTrip = trips.reduce<string | null>(
    (earliest, trip) => (earliest === null || trip.createdAt < earliest ? trip.createdAt : earliest),
    null,
  );
  const stats = [
    t("settings.profileTrips", { count: trips.length }),
    earliestTrip ? t("settings.profileSince", { date: formatMonthYear(earliestTrip, locale) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const contactSub =
    contacts.length > 0
      ? t("settings.emergencyContactsSub", { count: contacts.length, names: contacts.map((contact) => contact.name).join(", ") })
      : t("settings.emergencyContactsEmpty");

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];
  const themeLabel = themeOptions.find((option) => option.value === themeMode)?.label;

  const languageOptions: { value: SupportedLocale | null; label: string; detail?: string }[] = [
    { value: null, label: t("settings.languageSystem"), detail: t("settings.languageSystemDetail", { language: nativeLanguageName(deviceLocale) }) },
    ...LANGUAGE_OPTIONS.map((option) => ({ value: option.locale, label: option.nativeLabel })),
  ];

  const toggleBiometric = (value: boolean) => {
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
        { text: t("common.continue"), onPress: () => router.push("/(auth)/setup-pin?from=settings") },
      ]);
      return;
    }
    setBiometricEnabled(true);
  };

  const handleExport = () => {
    if (exporting) return;
    Alert.alert(t("settings.exportEverything"), t("settings.exportEverythingSub"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.continue"),
        onPress: async () => {
          setExporting(true);
          try {
            const shared = await exportEverything();
            if (!shared) Alert.alert(t("settings.exportUnavailableTitle"), t("settings.exportUnavailableBody"));
          } catch {
            Alert.alert(t("settings.exportFailedTitle"), t("settings.exportFailedBody"));
          } finally {
            setExporting(false);
          }
        },
      },
    ]);
  };

  const handleWipe = () => {
    if (wiping) return;
    Alert.alert(t("settings.wipeConfirmTitle"), t("settings.wipeConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          const ok = await confirmDeviceOwner(t("settings.wipeAuthTitle"), t("common.cancel"));
          if (!ok) return;
          setWiping(true);
          try {
            await wipeAllDeviceData();
            router.replace("/(auth)/sign-in");
          } catch {
            Alert.alert(t("settings.wipeFailedTitle"), t("settings.wipeFailedBody"));
          } finally {
            setWiping(false);
          }
        },
      },
    ]);
  };

  const signOutNow = async () => {
    await signOutAndCleanup();
    router.replace("/(auth)/sign-in");
  };

  // Backed-up and shared data leaves the phone on sign-out, so make sure pending changes reached the account first.
  const handleSignOut = () => {
    const backedUp = hasBackupOwner();
    Alert.alert(t("settings.signOutTitle"), t(backedUp ? "settings.signOutBodyBackedUp" : "settings.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.signOut"),
        style: "destructive",
        onPress: async () => {
          // Shared trips leave the phone on sign-out too, so their pending changes count as well.
          const sent = (await flushGroupSync()) && (!backedUp || (await flushSync()));
          if (!sent) {
            Alert.alert(t("settings.signOutUnsyncedTitle"), t("settings.signOutUnsyncedBody"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("settings.signOutAnyway"), style: "destructive", onPress: () => void signOutNow() },
            ]);
            return;
          }
          await signOutNow();
        },
      },
    ]);
  };

  const handleBackupToggle = (next: boolean) => {
    if (next) {
      setCloudBackupEnabled(true);
      return;
    }
    Alert.alert(t("settings.cloudBackupOffTitle"), t("settings.cloudBackupOffBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.cloudBackupOffConfirm"),
        style: "destructive",
        onPress: async () => {
          setBackupBusy(true);
          try {
            await disableBackup();
            setCloudBackupEnabled(false);
          } catch {
            Alert.alert(t("settings.cloudBackupOffFailed"));
          } finally {
            setBackupBusy(false);
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    if (deleting) return;
    Alert.alert(t("settings.deleteAccountTitle"), t("settings.deleteAccountBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.deleteAccountConfirm"),
        style: "destructive",
        onPress: async () => {
          const ok = await confirmDeviceOwner(t("settings.deleteAccountAuth"), t("common.cancel"));
          if (!ok) return;
          setDeleting(true);
          try {
            await deleteAccount({});
          } catch {
            setDeleting(false);
            Alert.alert(t("settings.deleteAccountFailedTitle"), t("settings.deleteAccountFailedBody"));
            return;
          }
          try {
            await wipeAllDeviceData();
          } catch {}
          setDeleting(false);
          Alert.alert(t("settings.deleteAccountDoneTitle"), t("settings.deleteAccountDoneBody"));
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  };

  const handleDisconnectGmail = () => {
    Alert.alert(t("settings.gmailDisconnectTitle"), t("settings.gmailDisconnectBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.gmailDisconnect"),
        style: "destructive",
        onPress: async () => {
          await disconnectGmail();
        },
      },
    ]);
  };

  const spinner = (color: string) => <ActivityIndicator color={color} />;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={[styles.eyebrow, { color: c.textMuted, fontFamily: f.medium }]}>{t("settings.subtitle")}</Text>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("settings.title")}</Text>
          </View>
          <PressableScale
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            style={[styles.close, { backgroundColor: c.surfaceStrong }]}
          >
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>

        <SettingsProfileHeader name={name} email={user?.email ?? user?.phone} avatarUrl={user?.avatarUrl} stats={stats} />

        <AuraListGroup title={t("settings.privacySection")}>
          <AuraListRow
            icon="faceId"
            tone={TEAL}
            label={t("settings.biometricUnlock", { name: biometric.name })}
            detail={t("settings.biometricUnlockSub", { name: biometric.name })}
            trailing={
              <AuraSwitch
                value={biometricEnabled}
                onValueChange={toggleBiometric}
                disabled={!biometricAvailable && !biometricEnabled}
                accessibilityLabel={t("settings.biometricUnlock", { name: biometric.name })}
              />
            }
          />
          {isPinSet ? (
            <AuraListRow
              icon="lock"
              tone={INDIGO}
              label={t("settings.autoLock")}
              value={formatAutoLock(autoLockTimeout, t)}
              onPress={() => setSheet("autoLock")}
            />
          ) : null}
          {isPinSet ? (
            <AuraListRow icon="edit" label={t("settings.changePin")} onPress={() => router.push("/(auth)/setup-pin?from=settings")} />
          ) : null}
          {gmailConnected ? (
            <AuraListRow
              icon="mail"
              tone={AMBER}
              label={t("settings.gmailConnected")}
              detail={gmailEmail ? t("settings.gmailConnectedAsSub", { email: gmailEmail }) : t("settings.gmailConnectedSub")}
              trailing={<Text style={[styles.inlineAction, { color: DANGER, fontFamily: f.medium }]}>{t("settings.gmailDisconnect")}</Text>}
              onPress={handleDisconnectGmail}
            />
          ) : null}
        </AuraListGroup>

        <AuraListGroup footer={t("settings.usageAnalyticsSub")} style={styles.attached}>
          <AuraListRow
            icon="trendUp"
            tone={INDIGO}
            label={t("settings.usageAnalytics")}
            trailing={
              <AuraSwitch value={analyticsEnabled} onValueChange={setAnalyticsEnabled} accessibilityLabel={t("settings.usageAnalytics")} />
            }
          />
          <AuraListRow icon="info" label={t("settings.privacyPolicy")} onPress={() => Linking.openURL(LEGAL_URLS.privacy).catch(() => {})} />
        </AuraListGroup>

        <AuraListGroup title={t("settings.safetySection")}>
          <AuraListRow icon="users" tone={DANGER} label={t("settings.emergencyContacts")} detail={contactSub} onPress={() => router.push("/emergency-contacts")} />
          <AuraListRow
            icon="clock"
            tone={TEAL}
            label={t("settings.defaultCheckIn")}
            value={formatShortDuration(defaultCheckInDuration, t)}
            onPress={() => setSheet("checkIn")}
          />
          <AuraListRow
            icon="messageCircle"
            tone={AMBER}
            label={t("settings.smsFallback")}
            detail={t("settings.smsFallbackSub")}
            onPress={() => setSheet("sms")}
          />
        </AuraListGroup>

        <AuraListGroup title={t("settings.appearanceLanguageSection")}>
          <AuraListRow icon="sparkle" tone={VIOLET} label={t("settings.appearance")} value={themeLabel} onPress={() => setSheet("appearance")} />
          <AuraListRow
            icon="globe"
            tone={INDIGO}
            label={t("settings.language")}
            value={localeOverride ? nativeLanguageName(localeOverride) : t("settings.languageSystem")}
            onPress={() => setSheet("language")}
          />
        </AuraListGroup>

        <AuraListGroup title={t("settings.tripsSection")}>
          <AuraListRow
            icon="flag"
            tone={AMBER}
            label={t("settings.tripMode")}
            detail={tripModeEnabled ? t("settings.tripModeSub") : t("settings.tripModeOffSub")}
            trailing={<AuraSwitch value={tripModeEnabled} onValueChange={setTripModeEnabled} accessibilityLabel={t("settings.tripMode")} />}
          />
        </AuraListGroup>

        <AuraListGroup title={t("settings.aiSection")}>
          <AuraListRow
            icon="cpu"
            tone={VIOLET}
            label={t("settings.localAi")}
            detail={
              aiDeviceSupported === false
                ? t("settings.aiUnsupported")
                : localAiEnabled
                  ? t("settings.localAiSub")
                  : t("settings.localAiDisabled")
            }
            trailing={
              <AuraSwitch
                value={localAiEnabled}
                onValueChange={setLocalAiEnabled}
                disabled={aiDeviceSupported === false}
                accessibilityLabel={t("settings.localAi")}
              />
            }
          />
        </AuraListGroup>

        <AuraListGroup title={t("settings.dataSection")} footer={t("settings.cloudBackupSub")}>
          <AuraListRow
            icon="globe"
            tone={TEAL}
            label={t("settings.cloudBackup")}
            trailing={
              backupBusy ? (
                spinner(c.textMuted)
              ) : (
                <AuraSwitch value={cloudBackupEnabled} onValueChange={handleBackupToggle} accessibilityLabel={t("settings.cloudBackup")} />
              )
            }
          />
          <AuraListRow
            icon="download"
            label={t("settings.exportEverything")}
            detail={t("settings.exportEverythingSub")}
            trailing={exporting ? spinner(c.textMuted) : undefined}
            onPress={handleExport}
          />
          <AuraListRow
            icon="trash"
            destructive
            label={t("settings.wipeDeviceData")}
            detail={t("settings.wipeDeviceDataSub")}
            trailing={wiping ? spinner(DANGER) : undefined}
            onPress={handleWipe}
          />
        </AuraListGroup>

        <AuraListGroup title={t("settings.accountSection")}>
          <AuraListRow icon="logout" label={t("settings.signOut")} detail={user?.email ?? user?.phone} onPress={handleSignOut} />
          <AuraListRow
            icon="trash"
            destructive
            label={t("settings.deleteAccount")}
            detail={t("settings.deleteAccountSub")}
            trailing={deleting ? spinner(DANGER) : undefined}
            disabled={deleting}
            onPress={handleDeleteAccount}
          />
        </AuraListGroup>

        <View style={styles.footer}>
          <Text style={[styles.tagline, { color: c.textSoft, fontFamily: f.medium }]}>{t("settings.footerTagline")}</Text>
          <Text style={[styles.version, { color: c.textMuted, fontFamily: f.regular }]}>
            {t("settings.versionLabel", { version: Constants.expoConfig?.version ?? "1.0.0" })}
          </Text>
          <Text style={[styles.credits, { color: c.textMuted, fontFamily: f.regular }]}>{t("settings.imageCredits")}</Text>
        </View>
      </ScrollView>

      <SettingsOptionSheet
        visible={sheet === "autoLock"}
        onClose={closeSheet}
        title={t("settings.autoLock")}
        subtitle={t("settings.autoLockSheetSub")}
        options={AUTO_LOCK_OPTIONS.map((ms) => ({ value: ms, label: formatAutoLock(ms, t) }))}
        selected={autoLockTimeout}
        onSelect={setAutoLockTimeout}
      />
      <SettingsOptionSheet
        visible={sheet === "checkIn"}
        onClose={closeSheet}
        title={t("settings.defaultCheckIn")}
        subtitle={t("settings.defaultCheckInSheetSub")}
        options={CHECK_IN_OPTIONS.map((seconds) => ({ value: seconds, label: formatShortDuration(seconds, t) }))}
        selected={defaultCheckInDuration}
        onSelect={setDefaultCheckInDuration}
      />
      <SettingsOptionSheet
        visible={sheet === "appearance"}
        onClose={closeSheet}
        title={t("settings.appearance")}
        options={themeOptions}
        selected={themeMode}
        onSelect={setThemeMode}
      />
      <SettingsOptionSheet
        visible={sheet === "language"}
        onClose={closeSheet}
        title={t("settings.language")}
        options={languageOptions}
        selected={localeOverride}
        onSelect={setLocaleOverride}
        footnote={t("settings.languageRtlNote")}
      />
      <SmsTemplatesSheet visible={sheet === "sms"} onClose={closeSheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eyebrow: { fontSize: 13.5 },
  title: { fontSize: 34, letterSpacing: -1.2 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginTop: 4 },
  attached: { marginTop: 12 },
  inlineAction: { fontSize: 14 },
  footer: { alignItems: "center", gap: 6, marginTop: 36 },
  tagline: { fontSize: 14, letterSpacing: -0.1 },
  version: { fontSize: 12.5 },
  credits: { fontSize: 11.5, lineHeight: 16, textAlign: "center", marginHorizontal: 12 },
});
