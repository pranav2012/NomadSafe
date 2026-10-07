import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import { api, useMutation, useQuery } from "@/modules/backend";
import {
  AuraListGroup,
  AuraListRow,
  AuraOptionSheet,
  AuraSwitch,
  Icon,
  PressableScale,
  showAlert,
  showToast,
  useAura,
  AuraTopFade,
} from "@/atoms";
import { auraHitSlop, auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { LEGAL_URLS, openLegalPage } from "@/constants/legal";
import { LANGUAGE_OPTIONS, useLocalization, type SupportedLocale } from "@/localization";
import { currencyCodes, currencyDisplayName } from "@/utils/currency";
import type { TimeFormat, UnitPrefs, UnitSystem } from "@/utils/units";
import { confirmDeviceOwner, disconnectGmail, signOutAndCleanup } from "@/features/auth/services/session";
import { disableBackup, flushGroupSync, flushSync, hasBackupOwner } from "@/features/sync";
import { localAuth, useAuthStore, useBiometricPresentation } from "@/features/auth";
import { AiKeySheet, AiUsageSheet } from "@/features/ai";
import { byokProviderName, useAiAvailability, useAiSources, useAiUsageLog, useByokStore, useProvisioningStore } from "@/modules/ai";
import { FREE_TRIP_LIMIT, manageSubscriptions, ownedTripCount, restorePurchases, usePlan } from "@/modules/billing";
import { track, PrivateView } from "@/modules/analytics";
import { showAdPrivacyOptions, useAdsStore } from "@/modules/ads";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { hasGmailGrant, hydrateGmailConnection, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";
import { ensureGmailAccountEmail } from "@/features/expenses/services/gmailAuth";
import { useSettingsStore } from "@/features/settings";
import { useCircle } from "@/features/location-sharing/hooks/useCircle";
import { exportEverything } from "@/features/settings/services/exportService";
import { wipeAllDeviceData } from "@/features/settings/services/wipeService";
import { SettingsProfileHeader } from "@/features/settings/components/SettingsProfileHeader";
import { CountryPickerSheet, useHomeCountry } from "@/features/passport";
import { countryDisplayName } from "@/features/trips/data/destinations";

const CHECK_IN_OPTIONS = [15 * 60, 30 * 60, 60 * 60, 2 * 60 * 60, 4 * 60 * 60, 8 * 60 * 60];
const AUTO_LOCK_OPTIONS = [0, 60_000, 5 * 60_000, 15 * 60_000];
const DANGER = auraStatusAccent.alert;
const [INDIGO, TEAL, VIOLET] = auraStatusColors.calm;
const AMBER = auraStatusAccent.live;

type ThemeMode = "light" | "dark" | "system";
type SheetId = "autoLock" | "checkIn" | "appearance" | "language" | "currency" | "units" | "timeFormat" | "homeCountry" | "aiKey" | "aiUsage";
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
  const { t, locale, deviceLocale, deviceCurrency, deviceUnits, deviceHour12 } = useLocalization();

  const user = useAuthStore((s) => s.user);
  const lockEnabled = useAuthStore((s) => s.lockEnabled);
  const autoLockTimeout = useAuthStore((s) => s.autoLockTimeout);
  const setAutoLockTimeout = useAuthStore((s) => s.setAutoLockTimeout);
  const deleteAccount = useMutation(api.account.deleteAccount);
  const biometric = useBiometricPresentation();

  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const localeOverride = useSettingsStore((s) => s.localeOverride);
  const setLocaleOverride = useSettingsStore((s) => s.setLocaleOverride);
  const currencyOverride = useSettingsStore((s) => s.currencyOverride);
  const setCurrencyOverride = useSettingsStore((s) => s.setCurrencyOverride);
  const unitSystem = useSettingsStore((s) => s.unitSystem);
  const setUnitSystem = useSettingsStore((s) => s.setUnitSystem);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const setTimeFormat = useSettingsStore((s) => s.setTimeFormat);
  const defaultCheckInDuration = useSettingsStore((s) => s.defaultCheckInDuration);
  const setDefaultCheckInDuration = useSettingsStore((s) => s.setDefaultCheckInDuration);
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const setLocalAiEnabled = useSettingsStore((s) => s.setLocalAiEnabled);
  const onlineAiEnabled = useSettingsStore((s) => s.onlineAiEnabled);
  const setOnlineAiEnabled = useSettingsStore((s) => s.setOnlineAiEnabled);
  const byok = useByokStore((s) => s.summary);
  const onlineAiSource = useAiAvailability().configured;
  const aiPick = useAiSources().selected;
  const plan = usePlan();
  const adChoicesRequired = useAdsStore((s) => s.privacyOptionsRequired);
  const cloudUsage = useQuery(api.ai.myUsage, plan.cloudAi ? {} : "skip");
  const byokUses = useAiUsageLog().byokTotal;
  const analyticsEnabled = useSettingsStore((s) => s.analyticsEnabled);
  const setAnalyticsEnabled = useSettingsStore((s) => s.setAnalyticsEnabled);
  const cloudBackupEnabled = useSettingsStore((s) => s.cloudBackupEnabled);
  const setCloudBackupEnabled = useSettingsStore((s) => s.setCloudBackupEnabled);

  const trips = useTripsStore((s) => s.trips);
  const aiDeviceSupported = useProvisioningStore((s) => s.deviceSupported);
  const gmailTokens = useGmailConnectionStore((s) => s.tokens);
  const gmailConnected = hasGmailGrant(gmailTokens);
  const gmailEmail = gmailTokens?.email;

  const circle = useCircle();
  const [exporting, setExporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const homeCountry = useHomeCountry();
  const setHomeCountry = useSettingsStore((s) => s.setHomeCountry);
  const [restoring, setRestoring] = useState(false);
  // Remounts the key sheet on each open so it starts from what's saved.
  const [keySheetSession, setKeySheetSession] = useState(0);
  const closeSheet = () => setSheet(null);

  useFocusEffect(
    useCallback(() => {
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

  const circleNames = circle.people.filter((person) => person.status === "accepted").map((person) => person.name);
  const circleSub =
    circleNames.length > 0
      ? t("settings.circleSub", { count: circleNames.length, names: circleNames.join(", ") })
      : t("settings.circleEmpty");

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

  const currencyOptions: { value: string | null; label: string; detail?: string }[] = [
    { value: null, label: t("settings.currencyAutomatic"), detail: t("settings.currencyAutomaticDetail", { currency: deviceCurrency }) },
    ...currencyCodes(deviceCurrency, currencyOverride ?? deviceCurrency).map((code) => ({
      value: code,
      label: `${code} · ${currencyDisplayName(code, locale)}`,
    })),
  ];
  const currencyValue = currencyOverride ?? t("settings.currencyAutomaticValue", { currency: deviceCurrency });

  const describeUnits = (prefs: UnitPrefs) => `°${prefs.temperature} · ${prefs.distance} · ${prefs.rain}`;
  const unitOptions: { value: UnitSystem | null; label: string; detail?: string }[] = [
    { value: null, label: t("settings.unitsAutomatic"), detail: t("settings.unitsAutomaticDetail", { units: describeUnits(deviceUnits) }) },
    { value: "metric", label: t("settings.unitsMetric"), detail: describeUnits({ temperature: "C", distance: "km", rain: "mm" }) },
    { value: "imperial", label: t("settings.unitsImperial"), detail: describeUnits({ temperature: "F", distance: "mi", rain: "in" }) },
  ];
  const unitsValue = unitOptions.find((option) => option.value === unitSystem)?.label;

  const sampleTime = (hour12: boolean) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12 }).format(new Date(2026, 0, 1, 14, 5));
  const timeFormatOptions: { value: TimeFormat | null; label: string; detail?: string }[] = [
    { value: null, label: t("settings.timeFormatAutomatic"), detail: t("settings.timeFormatAutomaticDetail", { example: sampleTime(deviceHour12) }) },
    { value: "12h", label: t("settings.timeFormat12h"), detail: sampleTime(true) },
    { value: "24h", label: t("settings.timeFormat24h"), detail: sampleTime(false) },
  ];
  const timeFormatValue = timeFormatOptions.find((option) => option.value === timeFormat)?.label;

  // Both directions ask for the phone's unlock: turning it on proves it works, turning it off proves it's the owner.
  const toggleAppLock = async (value: boolean) => {
    if (value && !(await localAuth.hasScreenLock().catch(() => false))) {
      showAlert(t("settings.screenLockNeededTitle"), t("settings.screenLockNeededBody"));
      return;
    }
    const result = await localAuth.authenticate(t(value ? "settings.appLockOnPrompt" : "settings.appLockOffPrompt")).catch(() => "failed" as const);
    if (result === "noScreenLock") {
      useAuthStore.getState().setLockEnabled(false);
      if (value) showAlert(t("settings.screenLockNeededTitle"), t("settings.screenLockNeededBody"));
      return;
    }
    if (result !== "ok") return;
    if (value) useAuthStore.getState().setUnlocked(true);
    useAuthStore.getState().setLockEnabled(value);
  };

  const handleExport = () => {
    if (exporting) return;
    showAlert(t("settings.exportEverything"), t("settings.exportEverythingSub"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.continue"),
        onPress: async () => {
          setExporting(true);
          try {
            const shared = await exportEverything();
            if (!shared) showAlert(t("settings.exportUnavailableTitle"), t("settings.exportUnavailableBody"));
          } catch {
            showAlert(t("settings.exportFailedTitle"), t("settings.exportFailedBody"));
          } finally {
            setExporting(false);
          }
        },
      },
    ]);
  };

  const handleWipe = () => {
    if (wiping) return;
    showAlert(t("settings.wipeConfirmTitle"), t("settings.wipeConfirmBody"), [
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
            showAlert(t("settings.wipeFailedTitle"), t("settings.wipeFailedBody"));
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
    showAlert(t("settings.signOutTitle"), t(backedUp ? "settings.signOutBodyBackedUp" : "settings.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.signOut"),
        style: "destructive",
        onPress: async () => {
          // Shared trips leave the phone on sign-out too, so their pending changes count as well.
          const sent = (await flushGroupSync()) && (!backedUp || (await flushSync()));
          if (!sent) {
            showAlert(t("settings.signOutUnsyncedTitle"), t("settings.signOutUnsyncedBody"), [
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
    showAlert(t("settings.cloudBackupOffTitle"), t("settings.cloudBackupOffBody"), [
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
            showAlert(t("settings.cloudBackupOffFailed"));
          } finally {
            setBackupBusy(false);
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    if (deleting) return;
    showAlert(t("settings.deleteAccountTitle"), t("settings.deleteAccountBody"), [
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
            showAlert(t("settings.deleteAccountFailedTitle"), t("settings.deleteAccountFailedBody"));
            return;
          }
          try {
            await wipeAllDeviceData();
          } catch {}
          setDeleting(false);
          showToast(t("settings.deleteAccountDoneTitle"), t("settings.deleteAccountDoneBody"));
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  };

  const handleDisconnectGmail = () => {
    showAlert(t("settings.gmailDisconnectTitle"), t("settings.gmailDisconnectBody"), [
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

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      track("purchases_restored", { tier: restored });
      if (restored === "free") showAlert(t("paywall.restoreNoneTitle"), t("paywall.restoreNoneBody"));
      else showToast(t("paywall.restoreDoneTitle"), t(restored === "pro" ? "paywall.restoreDonePro" : "paywall.restoreDonePlus"));
    } catch {
      showAlert(t("paywall.failedTitle"), t("paywall.restoreFailedBody"));
    } finally {
      setRestoring(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const outcome = await manageSubscriptions();
      if (outcome === "lifetime") showAlert(t("settings.lifetimeTitle"), t("settings.lifetimeBody"));
      else if (outcome === "test") showAlert(t("settings.testPurchaseTitle"), t("settings.testPurchaseBody"));
    } catch {
      showAlert(t("settings.manageFailedTitle"), t("settings.manageFailedBody"));
    }
  };

  const openKeySheet = () => {
    setKeySheetSession((value) => value + 1);
    setSheet("aiKey");
  };

  const planDetail =
    plan.tier === "pro"
      ? t("settings.planProDetail")
      : plan.tier === "plus"
        ? t("settings.planPlusDetail")
        : t("settings.planFreeDetail", { count: Math.min(ownedTripCount(trips), FREE_TRIP_LIMIT), limit: FREE_TRIP_LIMIT });
  const cloudLeft = cloudUsage ? Math.max(0, cloudUsage.chat.limit - cloudUsage.chat.used) : null;
  const onlineAiDetail = !onlineAiEnabled
    ? t("settings.onlineAiOff")
    : aiPick === "local"
      ? t("settings.onlineAiLocalPicked")
      : onlineAiSource === "byok" && byok
        ? t("settings.onlineAiByok", { provider: byokProviderName(byok) })
        : onlineAiSource === "cloud"
          ? t("settings.onlineAiCloud")
          : t("settings.onlineAiNone");

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
            hitSlop={auraHitSlop(38)}
            style={[styles.close, { backgroundColor: c.surfaceStrong }]}
          >
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>

        <SettingsProfileHeader name={name} email={user?.email ?? user?.phone} avatarUrl={user?.avatarUrl} stats={stats} />

        <AuraListGroup title={t("settings.planSection")}>
          <AuraListRow
            icon="star"
            tone={VIOLET}
            label={t(`paywall.tierName_${plan.tier}`)}
            detail={planDetail}
            value={plan.tier === "pro" || !plan.billingAvailable ? undefined : t("settings.planUpgrade")}
            onPress={() => router.push({ pathname: "/paywall", params: { reason: "settings" } })}
          />
          {plan.cloudAi ? (
            <AuraListRow
              icon="sparkle"
              tone={TEAL}
              label={t("settings.cloudAiUsage")}
              detail={t("settings.cloudAiUsageSub")}
              value={cloudLeft !== null ? t("settings.cloudAiLeft", { count: cloudLeft }) : undefined}
              onPress={() => setSheet("aiUsage")}
            />
          ) : null}
          {plan.tier !== "free" ? (
            <AuraListRow
              icon="settings"
              label={t("settings.manageSubscription")}
              detail={plan.lifetime ? t("settings.manageSubscriptionLifetimeSub") : t("settings.manageSubscriptionSub")}
              onPress={() => void handleManageSubscription()}
            />
          ) : null}
          {plan.billingAvailable ? (
            <AuraListRow
              icon="download"
              label={t("paywall.restore")}
              detail={t("settings.restoreSub")}
              trailing={restoring ? spinner(c.textMuted) : undefined}
              onPress={() => void handleRestore()}
            />
          ) : null}
        </AuraListGroup>

        <AuraListGroup title={t("settings.privacySection")}>
          <AuraListRow
            icon="faceId"
            tone={TEAL}
            label={t("settings.appLock")}
            detail={t("settings.appLockSub", { name: biometric.name })}
            trailing={
              <AuraSwitch
                value={lockEnabled}
                onValueChange={(value) => void toggleAppLock(value)}
                accessibilityLabel={t("settings.appLock")}
              />
            }
          />
          {lockEnabled ? (
            <AuraListRow
              icon="lock"
              tone={INDIGO}
              label={t("settings.autoLock")}
              detail={t("settings.autoLockSub")}
              value={formatAutoLock(autoLockTimeout, t)}
              onPress={() => setSheet("autoLock")}
            />
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
            detail={t("settings.usageAnalyticsShort")}
            trailing={
              <AuraSwitch value={analyticsEnabled} onValueChange={setAnalyticsEnabled} accessibilityLabel={t("settings.usageAnalytics")} />
            }
          />
          {plan.tier === "free" && adChoicesRequired ? (
            <AuraListRow
              icon="shield"
              tone={TEAL}
              label={t("settings.adPrivacyChoices")}
              detail={t("settings.adPrivacyChoicesSub")}
              onPress={() => void showAdPrivacyOptions()}
            />
          ) : null}
          <AuraListRow
            icon="info"
            label={t("settings.privacyPolicy")}
            detail={t("settings.privacyPolicySub")}
            onPress={() => openLegalPage(LEGAL_URLS.privacy)} />
        </AuraListGroup>

        <AuraListGroup title={t("settings.safetySection")}>
          <PrivateView>
            <AuraListRow icon="users" tone={DANGER} label={t("circle.title")} detail={circleSub} onPress={() => router.push("/circle")} />
          </PrivateView>
          <AuraListRow
            icon="clock"
            tone={TEAL}
            label={t("settings.defaultCheckIn")}
            detail={t("settings.defaultCheckInSub")}
            value={formatShortDuration(defaultCheckInDuration, t)}
            onPress={() => setSheet("checkIn")}
          />
        </AuraListGroup>

        <AuraListGroup title={t("settings.appearanceLanguageSection")}>
          <AuraListRow
            icon="sparkle"
            tone={VIOLET}
            label={t("settings.appearance")}
            detail={t("settings.appearanceSub")}
            value={themeLabel}
            onPress={() => setSheet("appearance")}
          />
          <AuraListRow
            icon="globe"
            tone={INDIGO}
            label={t("settings.language")}
            detail={t("settings.languageSub")}
            value={localeOverride ? nativeLanguageName(localeOverride) : t("settings.languageSystem")}
            onPress={() => setSheet("language")}
          />
          <AuraListRow
            icon="wallet"
            tone={TEAL}
            label={t("settings.currency")}
            detail={t("settings.currencySub")}
            value={currencyValue}
            onPress={() => setSheet("currency")}
          />
          <AuraListRow
            icon="compass"
            tone={AMBER}
            label={t("settings.units")}
            detail={t("settings.unitsSub")}
            value={unitsValue}
            onPress={() => setSheet("units")}
          />
          <AuraListRow
            icon="clock"
            tone={VIOLET}
            label={t("settings.timeFormat")}
            detail={t("settings.timeFormatSub")}
            value={timeFormatValue}
            onPress={() => setSheet("timeFormat")}
          />
        </AuraListGroup>

        <AuraListGroup title={t("settings.tripsSection")}>
          <AuraListRow
            icon="globe"
            tone={TEAL}
            label={t("settings.homeCountry")}
            detail={t("settings.homeCountrySub")}
            value={homeCountry.code ? countryDisplayName(homeCountry.code, locale) : t("settings.homeCountryNone")}
            onPress={() => setSheet("homeCountry")}
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
          <AuraListRow
            icon="globe"
            tone={INDIGO}
            label={t("settings.onlineAi")}
            detail={onlineAiDetail}
            trailing={<AuraSwitch value={onlineAiEnabled} onValueChange={setOnlineAiEnabled} accessibilityLabel={t("settings.onlineAi")} />}
          />
          <AuraListRow
            icon="lock"
            tone={AMBER}
            label={t("settings.aiKey")}
            detail={t("settings.aiKeySub")}
            value={byok ? byokProviderName(byok) : t("settings.aiKeyNone")}
            onPress={openKeySheet}
          />
          {!plan.cloudAi && byok ? (
            <AuraListRow
              icon="trendUp"
              tone={TEAL}
              label={t("settings.aiUsageTitle")}
              detail={t("settings.aiUsageByokSub", { provider: byokProviderName(byok) })}
              value={t("settings.aiUsageUses", { count: byokUses })}
              onPress={() => setSheet("aiUsage")}
            />
          ) : null}
        </AuraListGroup>

        <AuraListGroup title={t("settings.dataSection")} footer={t("settings.cloudBackupSub")}>
          <AuraListRow
            icon="globe"
            tone={TEAL}
            label={t("settings.cloudBackup")}
            detail={t("settings.cloudBackupShort")}
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
          <AuraListRow icon="logout" label={t("settings.signOut")} detail={user?.email ?? user?.phone ?? t("settings.signOutSub")} onPress={handleSignOut} />
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
      <AuraTopFade sheet />

      <AuraOptionSheet
        visible={sheet === "autoLock"}
        onClose={closeSheet}
        title={t("settings.autoLock")}
        subtitle={t("settings.autoLockSheetSub")}
        options={AUTO_LOCK_OPTIONS.map((ms) => ({ value: ms, label: formatAutoLock(ms, t) }))}
        selected={autoLockTimeout}
        onSelect={setAutoLockTimeout}
      />
      <AuraOptionSheet
        visible={sheet === "checkIn"}
        onClose={closeSheet}
        title={t("settings.defaultCheckIn")}
        subtitle={t("settings.defaultCheckInSheetSub")}
        options={CHECK_IN_OPTIONS.map((seconds) => ({ value: seconds, label: formatShortDuration(seconds, t) }))}
        selected={defaultCheckInDuration}
        onSelect={setDefaultCheckInDuration}
      />
      <AuraOptionSheet
        visible={sheet === "appearance"}
        onClose={closeSheet}
        title={t("settings.appearance")}
        options={themeOptions}
        selected={themeMode}
        onSelect={setThemeMode}
      />
      <AuraOptionSheet
        visible={sheet === "language"}
        onClose={closeSheet}
        title={t("settings.language")}
        options={languageOptions}
        selected={localeOverride}
        onSelect={setLocaleOverride}
        footnote={t("settings.languageRtlNote")}
      />
      <AuraOptionSheet
        visible={sheet === "currency"}
        onClose={closeSheet}
        title={t("settings.currency")}
        subtitle={t("settings.currencySheetSub")}
        options={currencyOptions}
        selected={currencyOverride}
        onSelect={setCurrencyOverride}
      />
      <AuraOptionSheet
        visible={sheet === "units"}
        onClose={closeSheet}
        title={t("settings.units")}
        options={unitOptions}
        selected={unitSystem}
        onSelect={setUnitSystem}
      />
      <CountryPickerSheet
        visible={sheet === "homeCountry"}
        onClose={closeSheet}
        title={t("settings.homeCountry")}
        automaticLabel={
          homeCountry.device ? t("settings.homeCountryAutomatic", { country: countryDisplayName(homeCountry.device, locale) }) : null
        }
        selected={homeCountry.automatic ? null : homeCountry.code}
        onSelect={setHomeCountry}
      />
      <AuraOptionSheet
        visible={sheet === "timeFormat"}
        onClose={closeSheet}
        title={t("settings.timeFormat")}
        options={timeFormatOptions}
        selected={timeFormat}
        onSelect={setTimeFormat}
      />
      <AiKeySheet key={`ai-key-${keySheetSession}`} visible={sheet === "aiKey"} onClose={closeSheet} />
      <AiUsageSheet visible={sheet === "aiUsage"} onClose={closeSheet} />
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
