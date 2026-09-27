import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as SMS from "expo-sms";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Icon } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { NomadButton } from "@/components/nomad/Button";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { selectActiveTrip, useTripsStore } from "@/features/trips/store/tripsStore";
import { useSettingsStore } from "@/features/settings";
import { smsFallbackStorage } from "@/features/safety/services/smsFallbackStorage";
import {
  computeSafetyScore,
  fetchAdvisory,
  type AdvisoryResult,
} from "@/features/safety/services/safetyAdvisoryService";
import {
  fetchEmergencyNumbers,
  type EmergencyNumbers,
} from "@/features/safety/services/emergencyNumberService";
import {
  buildMapsUrl,
  composeSms,
  getBestPosition,
  getContactPhones,
  hasBackgroundLocationPermission,
  restoreBroadcast,
  snapshotBroadcast,
  startEmergencyBroadcast,
  type AlertPosition,
  type BroadcastSnapshot,
} from "@/features/safety/services/sosService";
import {
  cancelCheckInNotifications,
  getNotificationPermission,
  scheduleCheckInNotifications,
  type NotificationPermission,
} from "@/features/safety/services/checkInNotifications";
import {
  isCheckInMissed,
  useSafetyStore,
  type SafetyEvent,
  type SafetyTrustedContact,
  type SmsDelivery,
} from "../store/safetyStore";
import { errorNotification, heavyImpact, lightImpact, successNotification } from "@/utils/haptics";

const PRESETS = [
  { duration: 15 * 60, sub: "safety.presetQuick" },
  { duration: 30 * 60, sub: "safety.presetQuick" },
  { duration: 60 * 60, sub: "safety.presetWalk" },
  { duration: 2 * 60 * 60, sub: "safety.presetHike" },
  { duration: 4 * 60 * 60, sub: "safety.presetBus" },
  { duration: 8 * 60 * 60, sub: "safety.presetDay" },
];

const SOS_HOLD_SECONDS = 2;
const SOS_CANCEL_WINDOW_SECONDS = 5;
const DEFAULT_TEMPLATE_KEYS = {
  sos: "safety.smsTemplateSos",
  missedCheckIn: "safety.smsTemplateMissedCheckIn",
} as const;

type AlertPurpose = keyof typeof DEFAULT_TEMPLATE_KEYS;
type Translate = (key: string, params?: Record<string, string | number>) => string;

function formatDurationLabel(seconds: number, t: Translate) {
  const hours = seconds / 3600;
  if (hours >= 1) {
    return t("safety.presetHours", { count: Number.isInteger(hours) ? hours : hours.toFixed(1) });
  }
  return t("safety.presetMinutes", { count: Math.round(seconds / 60) });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function SafetyScreen() {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t, formatTime, formatDate } = useLocalization();
  const router = useRouter();

  const status = useSafetyStore((s) => s.status);
  const checkInEndsAt = useSafetyStore((s) => s.checkInEndsAt);
  const startTimer = useSafetyStore((s) => s.startTimer);
  const stopTimer = useSafetyStore((s) => s.stopTimer);
  const extendTimer = useSafetyStore((s) => s.extendTimer);
  const markCheckInMissed = useSafetyStore((s) => s.markCheckInMissed);
  const recordMissedAlert = useSafetyStore((s) => s.recordMissedAlert);
  const missedAlert = useSafetyStore((s) => s.missedAlert);
  const triggerSos = useSafetyStore((s) => s.triggerSos);
  const recordSosDelivery = useSafetyStore((s) => s.recordSosDelivery);
  const recordSosBroadcast = useSafetyStore((s) => s.recordSosBroadcast);
  const sosDelivery = useSafetyStore((s) => s.sosDelivery);
  const sosBroadcast = useSafetyStore((s) => s.sosBroadcast);
  const cancelSos = useSafetyStore((s) => s.cancelSos);
  const storeContacts = useSafetyStore((s) => s.trustedContacts);
  const setStoreContacts = useSafetyStore((s) => s.setTrustedContacts);
  const events = useSafetyStore((s) => s.events);

  const activeTrip = useTripsStore(selectActiveTrip);
  const defaultCheckInDuration = useSettingsStore((s) => s.defaultCheckInDuration);

  const [now, setNow] = useState(() => Date.now());
  const [location, setLocation] = useState<{ latitude: number; longitude: number; timestamp: number | null } | null>(null);
  const [sosHoldSeconds, setSosHoldSeconds] = useState(0);
  const [locationGranted, setLocationGranted] = useState(false);
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [advisory, setAdvisory] = useState<AdvisoryResult | null>(null);
  const [advisoryLoading, setAdvisoryLoading] = useState(true);
  const [emergency, setEmergency] = useState<EmergencyNumbers | null>(null);
  const [phoneCount, setPhoneCount] = useState(() => getContactPhones().length);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const [scheduleFailed, setScheduleFailed] = useState(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [sosBusy, setSosBusy] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [missedBusy, setMissedBusy] = useState(false);

  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sosInFlightRef = useRef(false);

  // Re-sync contacts whenever the tab gains focus (they're edited on another screen).
  useFocusEffect(
    useCallback(() => {
      const contacts = emergencyContactsStorage.get();
      const mapped: SafetyTrustedContact[] = contacts.map((c) => ({
        id: c.id,
        name: c.name,
        relation: c.phone ? undefined : "Trusted",
      }));
      if (JSON.stringify(mapped) !== JSON.stringify(useSafetyStore.getState().trustedContacts)) {
        setStoreContacts(mapped);
      }
      setPhoneCount(getContactPhones().length);
    }, [setStoreContacts]),
  );

  // Live clock while a check-in runs; also refresh immediately on foreground.
  useEffect(() => {
    if (status !== "active") return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [status]);

  const isMissed = isCheckInMissed({ status, checkInEndsAt }, now);
  const isActive = status === "active" && !isMissed;
  const secondsLeft = isActive && checkInEndsAt ? Math.max(0, Math.ceil((checkInEndsAt - now) / 1000)) : 0;
  const overdueSeconds = isMissed && checkInEndsAt ? Math.floor((now - checkInEndsAt) / 1000) : 0;

  useEffect(() => {
    if (isMissed) markCheckInMissed();
  }, [isMissed, markCheckInMissed]);

  // Notification permission can change in system settings while backgrounded.
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      getNotificationPermission().then((p) => {
        if (mounted) setNotifPermission(p);
      });
    };
    refresh();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const notificationCopy = useMemo(() => ({
    channelName: t("safety.notifChannelName"),
    dueTitle: t("safety.notifDueTitle"),
    dueBody: t("safety.notifDueBody"),
    warningTitle: t("safety.notifWarningTitle"),
    warningBody: t("safety.notifWarningBody"),
  }), [t]);

  // Keeps the OS-scheduled reminders in sync with the persisted timer.
  useEffect(() => {
    if (status !== "active" || !checkInEndsAt) {
      if (status === "idle") void cancelCheckInNotifications();
      return;
    }
    if (checkInEndsAt <= Date.now()) return;
    let mounted = true;
    scheduleCheckInNotifications(checkInEndsAt, notificationCopy).then((result) => {
      if (!mounted || result === "stale") return;
      setScheduleFailed(result === "error");
      if (result === "permission-denied") setNotifPermission("denied");
      if (result === "scheduled") setNotifPermission("granted");
    });
    return () => {
      mounted = false;
    };
  }, [status, checkInEndsAt, notificationCopy]);

  // Get location + SMS availability for safety context.
  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const available = await SMS.isAvailableAsync();
        if (mounted) setSmsAvailable(available);
      } catch {
        if (mounted) setSmsAvailable(false);
      }
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        const granted = perm === Location.PermissionStatus.GRANTED;
        if (mounted) setLocationGranted(granted);
        if (!granted) return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (mounted) {
          setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, timestamp: loc.timestamp });
        }
      } catch (err) {
        // Location services off or unavailable; SOS will retry for a fresh fix.
        console.warn("Safety location bootstrap failed", err);
      }
    }
    bootstrap();
    return () => { mounted = false; };
  }, []);

  // Fetch the live travel advisory for the destination (or current location).
  const advisoryCoords = activeTrip?.destinationCoordinates?.[0] ?? location;
  const advisoryLat = advisoryCoords?.latitude;
  const advisoryLng = advisoryCoords?.longitude;
  useEffect(() => {
    if (advisoryLat == null || advisoryLng == null) return;
    let mounted = true;
    fetchAdvisory({ latitude: advisoryLat, longitude: advisoryLng })
      .then((result) => {
        if (mounted) setAdvisory(result);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setAdvisoryLoading(false);
      });
    return () => { mounted = false; };
  }, [advisoryLat, advisoryLng]);

  // Resolve local emergency numbers from the device's current location.
  const locationLat = location?.latitude;
  const locationLng = location?.longitude;
  useEffect(() => {
    if (locationLat == null || locationLng == null) return;
    let mounted = true;
    fetchEmergencyNumbers({ latitude: locationLat, longitude: locationLng }).then((result) => {
      if (mounted) setEmergency(result);
    });
    return () => { mounted = false; };
  }, [locationLat, locationLng]);

  useEffect(() => () => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  }, []);

  const formatCountdown = useCallback((totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, []);

  const destinationName = activeTrip?.destinations[0] ?? t("safety.fallbackLocation");
  const emergencyNumber = emergency?.general ?? "112";

  const callEmergency = useCallback(() => {
    Linking.openURL(`tel:${emergencyNumber}`).catch(() => {
      Alert.alert(t("sos.callEmergency", { number: emergencyNumber }), t("sos.callHint", { number: emergencyNumber }));
    });
  }, [emergencyNumber, t]);

  const showNoContactsAlert = useCallback(() => {
    errorNotification();
    Alert.alert(t("safety.noContactsTitle"), t("safety.noContactsBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("sos.callEmergency", { number: emergencyNumber }), onPress: callEmergency },
      { text: t("safety.addContacts"), onPress: () => router.push("/emergency-contacts") },
    ]);
  }, [callEmergency, emergencyNumber, router, t]);

  const buildMessage = useCallback((purpose: AlertPurpose, position: AlertPosition | null) => {
    const template = smsFallbackStorage.getCustom(purpose) ?? t(DEFAULT_TEMPLATE_KEYS[purpose]);
    if (!position) return `${template}\n${t("sos.locationUnavailable")}`;
    const url = buildMapsUrl(position);
    const line = position.source !== "fresh" && position.timestamp
      ? t("sos.locationLineStale", { time: formatTime(position.timestamp), url })
      : t("sos.locationLine", { url });
    return `${template}\n${line}`;
  }, [formatTime, t]);

  // Fresh fix -> compose SMS. Never throws; the outcome reflects what really happened.
  const sendAlertSms = useCallback(async (purpose: AlertPurpose): Promise<SmsDelivery> => {
    const phones = getContactPhones();
    try {
      const position = await getBestPosition(location);
      if (position) {
        setLocation({ latitude: position.latitude, longitude: position.longitude, timestamp: position.timestamp });
      }
      const outcome = await composeSms(phones, buildMessage(purpose, position));
      return { outcome, recipients: phones.length, hasLocation: !!position, at: Date.now() };
    } catch (err) {
      console.warn("Alert SMS failed", err);
      return { outcome: "failed", recipients: phones.length, hasLocation: false, at: Date.now() };
    }
  }, [buildMessage, location]);

  // Starts emergency broadcasting; undoes it if the SOS was cancelled meanwhile.
  const runEmergencyBroadcast = useCallback(async (previous: BroadcastSnapshot | null) => {
    setBroadcastBusy(true);
    recordSosBroadcast("starting");
    const result = await startEmergencyBroadcast();
    setBroadcastBusy(false);
    if (useSafetyStore.getState().status !== "emergency") {
      if (result === "started") await restoreBroadcast(previous);
      return;
    }
    recordSosBroadcast(result);
  }, [recordSosBroadcast]);

  const performSos = useCallback(async () => {
    if (sosInFlightRef.current) return;
    sosInFlightRef.current = true;
    setSosBusy(true);
    heavyImpact();
    const previous = snapshotBroadcast();
    triggerSos(previous);

    // With background permission already granted, start sharing right away (no dialogs).
    // Otherwise wait until after the SMS so a permission prompt can't delay it.
    let broadcastStarted = false;
    if (await hasBackgroundLocationPermission()) {
      broadcastStarted = true;
      void runEmergencyBroadcast(previous);
    }

    const delivery = await sendAlertSms("sos");
    recordSosDelivery(delivery);
    if (delivery.outcome === "failed") errorNotification();
    sosInFlightRef.current = false;
    setSosBusy(false);

    if (!broadcastStarted && useSafetyStore.getState().status === "emergency") {
      await runEmergencyBroadcast(previous);
    }
  }, [recordSosDelivery, runEmergencyBroadcast, sendAlertSms, triggerSos]);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setSosHoldSeconds(0);
  }, []);

  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setSosCountdown(null);
  }, []);

  const beginSosCountdown = useCallback(() => {
    if (sosInFlightRef.current || countdownTimerRef.current) return;
    if (getContactPhones().length === 0) {
      showNoContactsAlert();
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const endsAt = Date.now() + SOS_CANCEL_WINDOW_SECONDS * 1000;
    setSosCountdown(SOS_CANCEL_WINDOW_SECONDS);
    countdownTimerRef.current = setInterval(() => {
      const remaining = Math.ceil((endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        clearCountdown();
        void performSos();
        return;
      }
      setSosCountdown(remaining);
      lightImpact();
    }, 1000);
  }, [clearCountdown, performSos, showNoContactsAlert]);

  const handleSosPressIn = useCallback(() => {
    clearHold();
    if (countdownTimerRef.current || sosInFlightRef.current) return;
    const start = Date.now();
    holdTimerRef.current = setInterval(() => {
      const held = (Date.now() - start) / 1000;
      if (held >= SOS_HOLD_SECONDS) {
        clearHold();
        beginSosCountdown();
        return;
      }
      setSosHoldSeconds(held);
    }, 100);
  }, [beginSosCountdown, clearHold]);

  const handleCancelCountdown = useCallback(() => {
    clearCountdown();
    successNotification();
  }, [clearCountdown]);

  const handleSendNow = useCallback(() => {
    clearCountdown();
    void performSos();
  }, [clearCountdown, performSos]);

  const handleResendSos = useCallback(async () => {
    if (sosInFlightRef.current) return;
    if (getContactPhones().length === 0) {
      showNoContactsAlert();
      return;
    }
    sosInFlightRef.current = true;
    setSosBusy(true);
    recordSosDelivery(await sendAlertSms("sos"));
    sosInFlightRef.current = false;
    setSosBusy(false);
  }, [recordSosDelivery, sendAlertSms, showNoContactsAlert]);

  const handleRetryBroadcast = useCallback(() => {
    if (broadcastBusy) return;
    void runEmergencyBroadcast(useSafetyStore.getState().previousBroadcast);
  }, [broadcastBusy, runEmergencyBroadcast]);

  const handleStart = useCallback((duration: number) => {
    setScheduleFailed(false);
    startTimer(duration);
    heavyImpact();
  }, [startTimer]);

  const handleExtend = useCallback(() => {
    extendTimer(60 * 60);
    heavyImpact();
  }, [extendTimer]);

  const handleCheckIn = useCallback(() => {
    stopTimer();
    successNotification();
  }, [stopTimer]);

  const handleSendMissedAlert = useCallback(async () => {
    if (missedBusy) return;
    if (getContactPhones().length === 0) {
      showNoContactsAlert();
      return;
    }
    setMissedBusy(true);
    heavyImpact();
    recordMissedAlert(await sendAlertSms("missedCheckIn"));
    setMissedBusy(false);
  }, [missedBusy, recordMissedAlert, sendAlertSms, showNoContactsAlert]);

  const handleCancelSos = useCallback(() => {
    Alert.alert(t("safety.cancelTitle"), t("safety.cancelBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("safety.cancelConfirm"),
        style: "destructive",
        onPress: () => {
          const previous = useSafetyStore.getState().previousBroadcast;
          cancelSos();
          successNotification();
          void restoreBroadcast(previous);
        },
      },
    ]);
  }, [cancelSos, t]);

  const smsReady = smsAvailable && phoneCount > 0;
  const showNotificationWarning =
    status === "active" && (notifPermission === "denied" || scheduleFailed);

  const sensors = useMemo(() => [
    {
      icon: "mapPin" as const,
      title: t("safety.locationSensor"),
      sub: locationGranted ? t("safety.locationNormal") : t("safety.off"),
      tint: theme.tealSoft,
      color: theme.teal,
      on: locationGranted,
    },
    {
      icon: "bell" as const,
      title: t("safety.smsFallback"),
      sub: t("safety.smsVerified", { count: phoneCount }),
      tint: theme.mustardSoft,
      color: theme.mustard,
      on: smsReady,
    },
    {
      icon: "wifi" as const,
      title: t("safety.offlineSensor"),
      sub: t("safety.offlineBody"),
      tint: theme.stampSoft,
      color: theme.stamp,
      on: true,
    },
  ], [phoneCount, locationGranted, smsReady, t, theme]);

  const safetyScore = useMemo(
    () =>
      computeSafetyScore(advisory, {
        hasContacts: phoneCount > 0,
        locationGranted,
        timerActive: isActive,
        smsReady,
      }),
    [advisory, phoneCount, locationGranted, isActive, smsReady],
  );

  const FACTOR_GOOD = "#9FD4B8";
  const FACTOR_WARN = "#E8D29A";
  const FACTOR_BAD = "#E8A89A";

  const advisoryLabel = useMemo(() => {
    if (!advisory) return null;
    return {
      low: t("safety.riskLow"),
      moderate: t("safety.riskModerate"),
      high: t("safety.riskHigh"),
      extreme: t("safety.riskExtreme"),
    }[advisory.level];
  }, [advisory, t]);

  const heroStats = useMemo(() => {
    const advisoryColor = advisory
      ? { low: FACTOR_GOOD, moderate: FACTOR_WARN, high: FACTOR_BAD, extreme: FACTOR_BAD }[advisory.level]
      : FACTOR_WARN;
    return [
      { l: t("safety.factorAdvisory"), v: advisoryLabel ?? t("safety.none"), c: advisoryColor },
      {
        l: t("safety.factorContacts"),
        v: storeContacts.length > 0 ? t("safety.factorContactsSet", { count: storeContacts.length }) : t("safety.none"),
        c: phoneCount > 0 ? FACTOR_GOOD : FACTOR_BAD,
      },
      {
        l: t("safety.factorLocation"),
        v: locationGranted ? t("safety.on") : t("safety.off"),
        c: locationGranted ? FACTOR_GOOD : FACTOR_BAD,
      },
      {
        l: t("safety.factorCheckIn"),
        v: isMissed ? t("safety.missed") : isActive ? t("safety.active") : t("safety.idle"),
        c: isMissed ? FACTOR_BAD : isActive ? FACTOR_GOOD : FACTOR_WARN,
      },
    ];
  }, [advisory, advisoryLabel, storeContacts.length, phoneCount, locationGranted, isActive, isMissed, t]);

  const heroBody = advisory
    ? t("safety.advisoryBody", {
        country: advisory.countryName ?? destinationName,
        level: advisoryLabel,
      })
    : advisoryLoading && advisoryCoords
      ? t("safety.advisoryLoading")
      : t("safety.advisoryUnknown");

  const defaultDurationLabel = formatDurationLabel(defaultCheckInDuration, t);

  const eventMessage = (e: SafetyEvent) =>
    e.messageKey ? t(e.messageKey, e.messageParams) : e.message ?? "";

  const eventDayLabel = (e: SafetyEvent) => {
    const date = new Date(e.dateIso);
    if (Number.isNaN(date.getTime())) return e.dayLabel ?? "";
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    if (isSameDay(date, today)) return t("safety.today");
    if (isSameDay(date, yesterday)) return t("safety.yesterday");
    return formatDate(date);
  };

  const eventTimeLabel = (e: SafetyEvent) => {
    const date = new Date(e.dateIso);
    return Number.isNaN(date.getTime()) ? e.timeLabel ?? "" : formatTime(date);
  };

  const smsStatusText = (delivery: SmsDelivery | null, keys: Record<SmsDelivery["outcome"], string>) =>
    delivery
      ? t(keys[delivery.outcome], { count: delivery.recipients, time: formatTime(delivery.at) })
      : null;

  if (status === "emergency") {
    const sosStatus = sosBusy
      ? t("sos.statusPreparing")
      : smsStatusText(sosDelivery, {
          sent: "sos.statusSent",
          opened: "sos.statusOpened",
          cancelled: "sos.statusCancelled",
          failed: "sos.statusFailed",
        });
    const broadcastText = broadcastBusy
      ? t("sos.broadcastStarting")
      : sosBroadcast === "started"
        ? t("sos.broadcastOn")
        : sosBroadcast === "denied"
          ? t("sos.broadcastDenied")
          : sosBroadcast === "failed" || !sosBusy
            ? t("sos.broadcastOff")
            : null;
    const broadcastDown = !broadcastBusy && !sosBusy && sosBroadcast !== "started";

    return (
      <View style={{ flex: 1, backgroundColor: theme.stamp }}>
        <StatusBar style="light" />
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.emergencyScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.pulseWrap}>
              <View style={[styles.pulseRing, { borderColor: "rgba(255,255,255,0.4)" }]} />
              <View style={styles.pulseCore}>
                <Icon name="shield" size={60} color="#fff" strokeWidth={1.5} />
              </View>
            </View>

            <View style={{ paddingHorizontal: 22, marginTop: 20 }}>
              <Text style={styles.emergencyEyebrow}>{t("sos.codeRed")}</Text>
              <Text style={styles.emergencyTitle} accessibilityRole="header">{t("sos.sosActive")}</Text>
              <View accessibilityLiveRegion="polite">
                {sosStatus && <Text style={styles.emergencySub}>{sosStatus}</Text>}
                {sosDelivery && !sosDelivery.hasLocation && !sosBusy && (
                  <Text style={styles.emergencySubMuted}>{t("sos.noLocationIncluded")}</Text>
                )}
                {broadcastText && <Text style={styles.emergencySubMuted}>{broadcastText}</Text>}
                <Text style={styles.emergencySubMuted}>{t("sos.callHint", { number: emergencyNumber })}</Text>
              </View>
            </View>

            <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
              <View style={{ borderRadius: nomad.radii.xl, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}>
                {location ? (
                  <MapView
                    style={styles.emergencyMap}
                    provider={PROVIDER_DEFAULT}
                    initialRegion={{
                      latitude: location.latitude,
                      longitude: location.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    toolbarEnabled={false}
                    mapType="standard"
                  >
                    <Marker
                      coordinate={{ latitude: location.latitude, longitude: location.longitude }}
                      title={t("sos.broadcasting")}
                      pinColor={theme.stamp}
                    />
                  </MapView>
                ) : (
                  <View style={[styles.emergencyMap, styles.emergencyMapFallback]}>
                    <Icon name="mapPin" size={28} color="rgba(255,255,255,0.7)" />
                    <Text style={styles.emergencyMapFallbackText}>{t("sos.locating")}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.emergencyActions}>
              <Pressable
                onPress={callEmergency}
                style={styles.emergencyPrimary}
                accessibilityRole="button"
              >
                <Icon name="phone" size={18} color={theme.stamp} />
                <Text style={[styles.emergencyPrimaryText, { color: theme.stamp }]}>
                  {t("sos.callEmergency", { number: emergencyNumber })}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleResendSos}
                disabled={sosBusy}
                style={[styles.emergencySecondary, sosBusy && { opacity: 0.5 }]}
                accessibilityRole="button"
                accessibilityState={{ disabled: sosBusy }}
              >
                <Icon name="messageCircle" size={18} color="#fff" />
                <Text style={styles.emergencySecondaryText}>{t("sos.resendSms")}</Text>
              </Pressable>
              {broadcastDown && (
                <Pressable
                  onPress={sosBroadcast === "denied" ? () => Linking.openSettings() : handleRetryBroadcast}
                  style={styles.emergencySecondary}
                  accessibilityRole="button"
                >
                  <Icon name="mapPin" size={18} color="#fff" />
                  <Text style={styles.emergencySecondaryText}>
                    {sosBroadcast === "denied" ? t("sos.openSettings") : t("sos.retryBroadcast")}
                  </Text>
                </Pressable>
              )}
              <NomadButton theme={theme} variant="ghost" full onPress={handleCancelSos}>
                {t("sos.cancelSos")}
              </NomadButton>
              <Text style={styles.cancelHint}>{t("sos.cancelHint")}</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  const missedStatus = smsStatusText(missedAlert, {
    sent: "safety.missedAlertSent",
    opened: "safety.missedAlertOpened",
    cancelled: "safety.missedAlertCancelled",
    failed: "safety.missedAlertFailed",
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>{t("safety.eyebrow")}</Text>
              <Text style={[styles.title, { color: theme.inkDeep }]}>{t("safety.title")}</Text>
            </View>
            <View
              style={[
                styles.pill,
                { backgroundColor: isMissed ? theme.stampSoft : isActive ? theme.mustardSoft : theme.tealSoft },
              ]}
            >
              <View
                style={[
                  styles.pillDot,
                  { backgroundColor: isMissed ? theme.stamp : isActive ? theme.mustard : theme.teal },
                ]}
              />
              <Text style={[styles.pillText, { color: isMissed ? theme.stamp : isActive ? theme.mustard : theme.teal }]}>
                {isMissed ? t("safety.checkInMissed") : isActive ? t("safety.timerRunning") : t("safety.allClear")}
              </Text>
            </View>
          </View>

          <NomadCard theme={theme} style={styles.heroCard}>
            <View style={StyleSheet.absoluteFill}>
              <View style={{ position: "absolute", right: -20, top: -20, opacity: 0.15 }}>
                <Icon name="shield" size={140} color="#fff" strokeWidth={0.8} />
              </View>
            </View>
            <View style={styles.heroRow}>
              <View>
                <Text style={styles.heroEyebrow}>{t("safety.scoreLabel")}</Text>
                <Text style={styles.heroScore}>
                  {safetyScore}<Text style={styles.heroScoreDenom}>/100</Text>
                </Text>
              </View>
              <Text style={styles.heroBody}>
                {heroBody}
              </Text>
            </View>
            <View style={[styles.heroFooter, { borderTopColor: "rgba(255,255,255,0.18)" }]}>
              {heroStats.map((s, i) => (
                <View key={i} style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>{s.l}</Text>
                  <Text style={[styles.heroStatValue, { color: s.c }]}>{s.v}</Text>
                </View>
              ))}
            </View>
          </NomadCard>

          {isMissed && (
            <NomadCard
              theme={theme}
              style={[styles.missedCard, { backgroundColor: theme.stampSoft, borderColor: theme.stamp }]}
            >
              <View style={styles.missedHeader} accessibilityRole="alert">
                <Icon name="alertTriangle" size={22} color={theme.stamp} strokeWidth={2} />
                <Text style={[styles.missedTitle, { color: theme.stamp }]}>{t("safety.missedTitle")}</Text>
              </View>
              <Text style={[styles.missedBody, { color: theme.inkDeep }]}>
                {t("safety.missedBody", { time: checkInEndsAt ? formatTime(checkInEndsAt) : "" })}
              </Text>
              {missedStatus && (
                <Text style={[styles.missedBody, { color: theme.inkSoft }]} accessibilityLiveRegion="polite">
                  {missedStatus}
                </Text>
              )}
              <View style={styles.missedActions}>
                <NomadButton
                  theme={theme}
                  variant="stamp"
                  full
                  disabled={missedBusy}
                  icon={<Icon name="messageCircle" size={18} color="#fff" />}
                  onPress={handleSendMissedAlert}
                >
                  {t("safety.sendMissedAlert")}
                </NomadButton>
                <NomadButton theme={theme} variant="teal" full icon={<Icon name="check" size={18} color="#fff" />} onPress={handleCheckIn}>
                  {t("safety.imSafe")}
                </NomadButton>
                <NomadButton theme={theme} variant="ghost" full icon={<Icon name="plus" size={16} />} onPress={handleExtend}>
                  {t("safety.extendOneHour")}
                </NomadButton>
              </View>
            </NomadCard>
          )}

          {showNotificationWarning && (
            <NomadCard theme={theme} style={[styles.warningCard, { backgroundColor: theme.mustardSoft, borderColor: theme.mustard }]}>
              <View style={styles.missedHeader}>
                <Icon name="bell" size={18} color={theme.mustard} strokeWidth={2} />
                <Text style={[styles.warningTitle, { color: theme.inkDeep }]}>
                  {scheduleFailed && notifPermission !== "denied" ? t("safety.notificationsScheduleFailed") : t("safety.notificationsOffTitle")}
                </Text>
              </View>
              {notifPermission === "denied" && (
                <>
                  <Text style={[styles.missedBody, { color: theme.inkSoft }]}>{t("safety.notificationsOffBody")}</Text>
                  <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" hitSlop={8}>
                    <Text style={[styles.warningLink, { color: theme.inkDeep }]}>{t("safety.openSettings")}</Text>
                  </Pressable>
                </>
              )}
            </NomadCard>
          )}

          <View style={styles.countdownWrap}>
            <View style={{ position: "relative", width: 260, height: 260 }}>
              <View style={StyleSheet.absoluteFill}>
                <Icon name="clock" size={260} color="transparent" />
              </View>
              <View style={styles.countdownCenter} accessible>
                <Text style={[styles.countdownEyebrow, { color: isMissed ? theme.stamp : theme.inkMuted }]}>
                  {isMissed ? t("safety.overdueBy") : isActive ? t("safety.checkInWithin") : t("safety.startCheckIn")}
                </Text>
                <Text style={[styles.countdownValue, { color: isMissed ? theme.stamp : theme.inkDeep }]}>
                  {isMissed ? `+${formatCountdown(overdueSeconds)}` : isActive ? formatCountdown(secondsLeft) : "00:00"}
                </Text>
                <Text style={[styles.countdownSub, { color: isMissed ? theme.stamp : theme.inkSoft }]}>
                  {isMissed ? t("safety.checkInMissed") : isActive ? t("safety.autoAlert") : t("safety.setTarget")}
                </Text>
              </View>
            </View>
          </View>

          {status === "idle" && (
            <View style={styles.presets}>
              {PRESETS.map((p) => (
                <Pressable
                  key={p.duration}
                  onPress={() => handleStart(p.duration)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.preset,
                    { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <Text style={[styles.presetLabel, { color: theme.inkDeep }]}>{formatDurationLabel(p.duration, t)}</Text>
                  <Text style={[styles.presetSub, { color: theme.inkMuted }]}>{t(p.sub)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.actions}>
            {status === "idle" ? (
              <NomadButton theme={theme} variant="teal" full icon={<Icon name="clock" size={18} color="#fff" />} onPress={() => handleStart(defaultCheckInDuration)}>
                {t("safety.startDefault", { duration: defaultDurationLabel })}
              </NomadButton>
            ) : isActive ? (
              <>
                <NomadButton theme={theme} variant="teal" full icon={<Icon name="check" size={18} color="#fff" />} onPress={handleCheckIn}>
                  {t("safety.imSafe")}
                </NomadButton>
                <NomadButton theme={theme} variant="ghost" full icon={<Icon name="plus" size={16} />} onPress={handleExtend}>
                  {t("safety.extendOneHour")}
                </NomadButton>
              </>
            ) : null}
          </View>

          <NomadCard theme={theme} style={[styles.sosCard, { backgroundColor: isDark ? "rgba(224,96,68,0.08)" : theme.stampSoft, borderColor: theme.stamp, borderStyle: "dashed" }]}>
            <View style={styles.sosRow}>
              <Pressable
                onPressIn={handleSosPressIn}
                onPressOut={clearHold}
                style={styles.sosButton}
                accessibilityRole="button"
                accessibilityLabel={t("safety.sosA11yLabel")}
                accessibilityHint={t("safety.sosA11yHint")}
                accessibilityActions={[{ name: "activate", label: t("safety.sosA11yLabel") }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "activate") beginSosCountdown();
                }}
              >
                <Text style={styles.sosButtonText}>SOS</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sosTitle, { color: theme.stamp }]}>{t("safety.holdForEmergency")}</Text>
                <Text style={[styles.sosBody, { color: theme.inkSoft }]}>
                  {t("safety.sosBody", { count: phoneCount })}
                </Text>
              </View>
            </View>
            {sosHoldSeconds > 0 && (
              <View style={styles.sosProgress}>
                <View style={[styles.sosProgressFill, { width: `${Math.min(100, (sosHoldSeconds / SOS_HOLD_SECONDS) * 100)}%`, backgroundColor: theme.stamp }]} />
              </View>
            )}
          </NomadCard>

          <View style={styles.sectionRow}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("safety.recentActivity")}</Text>
            <View style={[styles.sectionLine, { backgroundColor: theme.hairline }]} />
          </View>
          <NomadCard theme={theme} style={styles.timelineCard}>
            {events.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.inkSoft }]}>{t("safety.noActivity")}</Text>
            ) : (
              events.slice(0, 6).map((e, i, arr) => (
                <View key={e.id} style={[styles.timelineRow, i < arr.length - 1 && { paddingBottom: 12 }]}>
                  <View style={styles.timelineIconCol}>
                    <View style={[styles.timelineIcon, { backgroundColor: theme[`${e.color}Soft` as keyof typeof theme] as string }]}>
                      <Icon name={e.icon} size={12} color={theme[e.color]} strokeWidth={2.2} />
                    </View>
                    {i < arr.length - 1 && <View style={[styles.timelineLine, { backgroundColor: theme.hairline }]} />}
                  </View>
                  <View style={styles.timelineContent}>
                    <View style={styles.timelineHeader}>
                      <Text style={[styles.timelineMessage, { color: theme.inkDeep }]}>{eventMessage(e)}</Text>
                      <Text style={[styles.timelineTime, { color: theme.inkMuted }]}>{eventTimeLabel(e)}</Text>
                    </View>
                    <Text style={[styles.timelineDay, { color: theme.inkMuted }]}>{eventDayLabel(e)}</Text>
                  </View>
                </View>
              ))
            )}
          </NomadCard>

          <View style={styles.sectionRow}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("safety.sensors")}</Text>
            <View style={[styles.sectionLine, { backgroundColor: theme.hairline }]} />
          </View>
          <View style={styles.sensorList}>
            {sensors.map((s, i) => (
              <NomadCard key={i} theme={theme} style={styles.sensorCard}>
                <View style={[styles.sensorIcon, { backgroundColor: s.tint }]}>
                  <Icon name={s.icon} size={18} color={s.color} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sensorTitle, { color: theme.inkDeep }]}>{s.title}</Text>
                  <Text style={[styles.sensorSub, { color: theme.inkSoft }]}>{s.sub}</Text>
                </View>
                <View style={[styles.toggleTrack, { backgroundColor: s.on ? theme.teal : theme.hairline }]}>
                  <View style={[styles.toggleThumb, { left: s.on ? 20 : 2 }]} />
                </View>
              </NomadCard>
            ))}
          </View>

          <View style={{ height: 140 }} />
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={sosCountdown !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleCancelCountdown}
      >
        <View style={styles.countdownOverlay}>
          <View style={[styles.countdownSheet, { backgroundColor: theme.stamp }]}>
            <Text style={styles.emergencyEyebrow}>{t("sos.codeRed")}</Text>
            <Text style={styles.countdownOverlayTitle} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              {t("sos.countdownTitle", { seconds: sosCountdown ?? 0 })}
            </Text>
            <Text style={styles.emergencySub}>{t("sos.countdownBody", { count: phoneCount })}</Text>
            <View style={styles.countdownButtons}>
              <Pressable
                onPress={handleCancelCountdown}
                style={styles.emergencyPrimary}
                accessibilityRole="button"
              >
                <Text style={[styles.emergencyPrimaryText, { color: theme.stamp }]}>{t("sos.countdownCancel")}</Text>
              </Pressable>
              <Pressable onPress={handleSendNow} style={styles.emergencySecondary} accessibilityRole="button">
                <Text style={styles.emergencySecondaryText}>{t("sos.countdownSendNow")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 120 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    marginBottom: 14,
  },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 40,
    lineHeight: 42,
    fontWeight: "500",
    letterSpacing: -0.8,
    marginTop: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillDot: { width: 6, height: 6, borderRadius: 999 },
  pillText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  heroCard: {
    backgroundColor: "#2B6C5F",
    borderColor: "transparent",
    overflow: "hidden",
    marginBottom: 14,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    position: "relative",
  },
  heroEyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "700",
    color: "rgba(255,255,255,0.8)",
    textTransform: "uppercase",
  },
  heroScore: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 54,
    lineHeight: 54,
    color: "#fff",
    letterSpacing: -1,
    marginTop: 4,
  },
  heroScoreDenom: { fontSize: 22, opacity: 0.55 },
  heroBody: {
    flex: 1,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(255,255,255,0.9)",
  },
  heroFooter: {
    flexDirection: "row",
    gap: 6,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  heroStat: { flex: 1 },
  heroStatLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9,
    letterSpacing: 1,
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
  },
  heroStatValue: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 3,
  },
  countdownWrap: {
    alignItems: "center",
    marginVertical: 6,
  },
  countdownCenter: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  countdownEyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  countdownValue: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 64,
    lineHeight: 64,
  },
  countdownSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11,
    marginTop: 4,
  },
  presets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  preset: {
    width: "31.5%",
    flexGrow: 1,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 3,
  },
  presetLabel: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 19,
    fontWeight: "500",
  },
  presetSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  actions: { gap: 8, marginBottom: 14 },
  sosCard: { marginBottom: 14 },
  sosRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  sosButton: {
    width: 54,
    height: 54,
    borderRadius: 999,
    backgroundColor: "#C6432A",
    alignItems: "center",
    justifyContent: "center",
  },
  sosButtonText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 14,
    color: "#fff",
    letterSpacing: 1,
  },
  sosTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "500",
  },
  sosBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  sosProgress: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(198,67,42,0.15)",
    marginTop: 12,
    overflow: "hidden",
  },
  sosProgressFill: { height: "100%" },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 6,
  },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  sectionLine: { flex: 1, height: 1 },
  timelineCard: { marginBottom: 14 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineIconCol: {
    width: 22,
    alignItems: "center",
  },
  timelineIcon: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineLine: {
    width: 1,
    flex: 1,
    marginTop: 4,
    minHeight: 16,
  },
  timelineContent: { flex: 1, paddingBottom: 4 },
  timelineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  timelineMessage: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  timelineTime: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 11,
  },
  timelineDay: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginTop: 2,
  },
  sensorList: { gap: 8, marginBottom: 14 },
  sensorCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  sensorIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sensorTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
    fontWeight: "600",
  },
  sensorSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11.5,
    marginTop: 1,
  },
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: 999,
    position: "relative",
  },
  toggleThumb: {
    position: "absolute",
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  emptyText: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 12,
  },
  emergencyScroll: { paddingTop: 16, paddingBottom: 140 },
  emergencyEyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 2.5,
    fontWeight: "700",
    color: "rgba(255,255,255,0.75)",
    textTransform: "uppercase",
    textAlign: "center",
  },
  emergencyTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 42,
    lineHeight: 44,
    color: "#fff",
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
    fontWeight: "500",
  },
  emergencySub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 20,
  },
  pulseWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    paddingBottom: 18,
    height: 158,
  },
  pulseRing: {
    position: "absolute",
    width: 172,
    height: 172,
    borderRadius: 999,
    borderWidth: 2,
  },
  pulseCore: {
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  emergencyMap: { width: "100%", height: 160 },
  emergencyMapFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  emergencyMapFallbackText: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
  },
  emergencyActions: {
    paddingHorizontal: 16,
    marginTop: 20,
    gap: 10,
  },
  emergencySecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  emergencySecondaryText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
  cancelHint: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    marginTop: 2,
  },
  emergencySubMuted: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  emergencyPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#fff",
  },
  emergencyPrimaryText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 16,
    fontWeight: "700",
  },
  missedCard: { marginBottom: 14, borderWidth: 1.5 },
  missedHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  missedTitle: {
    flex: 1,
    fontFamily: NOMAD_FONTS.display,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "500",
  },
  missedBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  missedActions: { gap: 8, marginTop: 14 },
  warningCard: { marginBottom: 14, borderWidth: 1 },
  warningTitle: {
    flex: 1,
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
    fontWeight: "600",
  },
  warningLink: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
    marginTop: 10,
  },
  countdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 20,
  },
  countdownSheet: {
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  countdownOverlayTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 34,
    lineHeight: 38,
    color: "#fff",
    textAlign: "center",
    marginTop: 10,
    fontWeight: "500",
  },
  countdownButtons: { gap: 10, marginTop: 22 },
});
