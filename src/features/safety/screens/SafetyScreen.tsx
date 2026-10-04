import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useNetworkState } from "expo-network";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { api, useQuery } from "@/modules/backend";
import { getCurrentPosition, getLastKnownPosition, requestForegroundPermission } from "@/modules/location";
import { AuraButton, AuraCard, AuraChip, AuraSection, Icon, showAlert, useAura, useTabBarInset } from "@/atoms";
import { auraStatusAccent, type AuraStatus } from "@/constants/aura";
import { ActionButton } from "@/features/home/components/aura/ActionButton";
import { useLocalization } from "@/localization";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { useSettingsStore } from "@/features/settings";
import { isLocationBroadcastRunning } from "@/features/location-sharing";
import {
  BackgroundLocationDisclosure,
  hasAcceptedBackgroundDisclosure,
} from "@/features/location-sharing/components/BackgroundLocationDisclosure";
import { LiveSharingCard } from "@/features/location-sharing/components/LiveSharingCard";
import { SharingPeople, type IncomingShare } from "@/features/location-sharing/components/SharingPeople";
import { useBroadcastToggle } from "@/features/location-sharing/hooks/useBroadcastToggle";
import { smsFallbackStorage } from "@/features/safety/services/smsFallbackStorage";
import {
  fetchEmergencyNumbers,
  readLastEmergencyNumbers,
  type EmergencyNumbers,
} from "@/features/safety/services/emergencyNumberService";
import {
  buildMapsUrl,
  canAutoStartEmergencyBroadcast,
  composeSms,
  getBestPosition,
  getContactPhones,
  restoreBroadcast,
  snapshotBroadcast,
  startEmergencyBroadcast,
  type AlertPosition,
  type BroadcastSnapshot,
} from "@/features/safety/services/sosService";
import { readLastKnownFix, saveLastKnownFix } from "@/features/safety/services/lastKnownLocation";
import { authorizeSosCancel } from "@/features/safety/services/sosOwnerAuth";
import {
  alertContactsSos,
  CHECK_IN_ALERT_GRACE_MS,
  publishSosPosition,
  resolveSosOnServer,
} from "@/features/safety/services/safetyServerAlerts";
import { useQuickSosStore } from "@/features/safety/store/quickSosStore";
import {
  cancelCheckInNotifications,
  scheduleCheckInNotifications,
} from "@/features/safety/services/checkInNotifications";
import { useSafetyReadiness } from "@/features/safety/hooks/useSafetyReadiness";
import { SafetyReadinessChecklist } from "@/features/safety/components/SafetyReadinessChecklist";
import { CheckInCard } from "@/features/safety/components/CheckInCard";
import { EmergencyTakeover, SosCountdownOverlay } from "@/features/safety/components/EmergencyTakeover";
import { LocationActionsSheet } from "@/features/safety/components/LocationActionsSheet";
import { SafetyMapHero } from "@/features/safety/components/SafetyMapHero";
import { SosHoldButton } from "@/features/safety/components/SosHoldButton";
import {
  isCheckInMissed,
  useSafetyStore,
  type SafetyTrustedContact,
  type SmsDelivery,
} from "../store/safetyStore";
import { errorNotification, heavyImpact, lightImpact, successNotification } from "@/utils/haptics";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";

const PRESETS = [15 * 60, 30 * 60, 60 * 60, 2 * 60 * 60, 4 * 60 * 60, 8 * 60 * 60];

const SOS_HOLD_SECONDS = 2;
const SOS_CANCEL_WINDOW_SECONDS = 5;
const STALE_AFTER_MS = 15 * 60_000;
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

/** Short relative age such as "just now", "5 min ago", "2 hr ago". */
function formatAge(ms: number, t: Translate) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return t("sos.ageJustNow");
  if (minutes < 60) return t("sos.ageMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("sos.ageHours", { count: hours });
  return t("sos.ageDays", { count: Math.floor(hours / 24) });
}

function formatCoords({ latitude, longitude }: { latitude: number; longitude: number }) {
  return `${Math.abs(latitude).toFixed(3)}°${latitude >= 0 ? "N" : "S"} · ${Math.abs(longitude).toFixed(3)}°${longitude >= 0 ? "E" : "W"}`;
}

type Coords = { latitude: number; longitude: number; accuracy: number | null; timestamp: number | null };

/**
 * Safety and live sharing in one tab: a map of you and the people sharing with you, the SOS /
 * check-in / share / call actions, then live location, people, check-in and readiness. While an
 * SOS is active the whole tab becomes the emergency takeover.
 */
export default function SafetyScreen() {
  const { c, f, isDark } = useAura();
  const { t, formatTime } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { width } = useWindowDimensions();

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
  const sosContactAlert = useSafetyStore((s) => s.sosContactAlert);
  const recordSosContactAlert = useSafetyStore((s) => s.recordSosContactAlert);
  const cancelSos = useSafetyStore((s) => s.cancelSos);
  const addEvent = useSafetyStore((s) => s.addEvent);
  const setStoreContacts = useSafetyStore((s) => s.setTrustedContacts);

  const defaultCheckInDuration = useSettingsStore((s) => s.defaultCheckInDuration);
  const share = useBroadcastToggle();
  const incomingShares = useQuery(api.sharing.getIncomingShares) as IncomingShare[] | undefined;
  const contactLinks = useQuery(api.sharing.getContactLinks);
  // NomadSafe contacts who get an instant push on SOS or a missed check-in; undefined while loading.
  const linkedCount = contactLinks?.outgoing.filter((link) => link.status === "accepted").length;

  const [now, setNow] = useState(() => Date.now());
  const [location, setLocation] = useState<Coords | null>(() => readLastKnownFix());
  const [sosHoldSeconds, setSosHoldSeconds] = useState(0);
  const [emergency, setEmergency] = useState<EmergencyNumbers | null>(() => readLastEmergencyNumbers());
  const [scheduleFailed, setScheduleFailed] = useState(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [sosBusy, setSosBusy] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastRunning, setBroadcastRunning] = useState(false);
  const [missedBusy, setMissedBusy] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [disclosureFor, setDisclosureFor] = useState<"readiness" | "sos" | null>(null);
  const [safeFollowUp, setSafeFollowUp] = useState(false);
  const [safeBusy, setSafeBusy] = useState(false);
  const [mapTouched, setMapTouched] = useState(false);
  const [coordsOpen, setCoordsOpen] = useState(false);

  const network = useNetworkState();
  const isOffline = network.isConnected === false || network.isInternetReachable === false;

  const {
    readiness,
    refresh: refreshReadiness,
    fixForeground,
    requestBackground,
    fixNotifications,
    openBatterySettings,
  } = useSafetyReadiness(t("safety.notifChannelName"));
  const phoneCount = readiness.contactsWithPhone;

  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sosInFlightRef = useRef(false);
  const fromWidgetRef = useRef(false);

  // Re-sync contacts whenever the tab gains focus (they're edited on another screen).
  useFocusEffect(
    useCallback(() => {
      const contacts = emergencyContactsStorage.get();
      const mapped: SafetyTrustedContact[] = contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        relation: contact.phone ? undefined : "Trusted",
      }));
      if (JSON.stringify(mapped) !== JSON.stringify(useSafetyStore.getState().trustedContacts)) {
        setStoreContacts(mapped);
      }
    }, [setStoreContacts]),
  );

  // Coarse clock while a check-in or SOS runs, plus an exact tick when the timer runs out; the
  // per-second countdown lives in CheckInCard so the whole screen (and its map) doesn't re-render.
  useEffect(() => {
    if (status === "idle") return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 15_000);
    const dueIn = status === "active" && checkInEndsAt ? checkInEndsAt - Date.now() : -1;
    const dueTimer = dueIn > 0 ? setTimeout(tick, dueIn + 50) : undefined;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") tick();
    });
    return () => {
      clearInterval(id);
      clearTimeout(dueTimer);
      sub.remove();
    };
  }, [status, checkInEndsAt]);

  const isMissed = isCheckInMissed({ status, checkInEndsAt }, now);
  const isActive = status === "active" && !isMissed;

  useEffect(() => {
    if (isMissed) markCheckInMissed();
  }, [isMissed, markCheckInMissed]);

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
      if (result === "permission-denied" || result === "scheduled") void refreshReadiness();
    });
    return () => {
      mounted = false;
    };
  }, [status, checkInEndsAt, notificationCopy, refreshReadiness]);

  // Get a location fix for safety context and persist it for offline SOS.
  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const { status: perm } = await requestForegroundPermission();
        void refreshReadiness();
        if (perm !== "granted") return;
        // A fresh fix can take a while indoors; show the phone's last known position meanwhile.
        const recent = await getLastKnownPosition({ maxAge: 30 * 60_000 }).catch(() => null);
        if (recent && mounted) {
          setLocation((current) =>
            current ?? {
              latitude: recent.latitude,
              longitude: recent.longitude,
              accuracy: recent.accuracy,
              timestamp: recent.timestamp,
            },
          );
        }
        const loc = await getCurrentPosition("balanced");
        const fix = {
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          timestamp: loc.timestamp,
        };
        saveLastKnownFix(fix);
        if (mounted) setLocation(fix);
      } catch (err) {
        // Location services off or unavailable; SOS will retry for a fresh fix.
        logger.warn("safety", "location bootstrap failed", err);
      }
    }
    bootstrap();
    return () => { mounted = false; };
  }, [refreshReadiness]);

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

  // "Broadcasting" is shown only while the OS location task is really running.
  useEffect(() => {
    if (status !== "emergency") return;
    let mounted = true;
    const check = () => {
      isLocationBroadcastRunning().then((running) => {
        if (mounted) setBroadcastRunning(running);
      });
    };
    check();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [status, sosBroadcast]);

  useEffect(() => () => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  }, []);

  const emergencyNumber = emergency?.general ?? "112";

  const callEmergency = useCallback(() => {
    Linking.openURL(`tel:${emergencyNumber}`).catch(() => {
      showAlert(t("sos.callEmergency", { number: emergencyNumber }), t("sos.callHint", { number: emergencyNumber }));
    });
  }, [emergencyNumber, t]);

  const showNoContactsAlert = useCallback(() => {
    errorNotification();
    showAlert(t("safety.noContactsTitle"), t("safety.noContactsBody"), [
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
      ? t("sos.locationLineStale", {
          time: formatTime(position.timestamp),
          age: formatAge(Date.now() - position.timestamp, t),
          url,
        })
      : t("sos.locationLine", { url });
    return `${template}\n${line}`;
  }, [formatTime, t]);

  // Fresh fix -> compose SMS. Never throws; the outcome reflects what really happened.
  const sendAlertSms = useCallback(async (purpose: AlertPurpose): Promise<SmsDelivery> => {
    const phones = getContactPhones();
    try {
      const position = await getBestPosition(location);
      if (position) {
        setLocation({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          timestamp: position.timestamp,
        });
        if (purpose === "sos") publishSosPosition(position);
      }
      const outcome = await composeSms(phones, buildMessage(purpose, position));
      return { outcome, recipients: phones.length, hasLocation: !!position, at: Date.now() };
    } catch (err) {
      logger.error("sos", "alert SMS failed", err);
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

  // Back from system settings with "Allow all the time" granted: start sharing without another tap.
  useEffect(() => {
    if (status !== "emergency" || sosBroadcast !== "denied") return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void canAutoStartEmergencyBroadcast().then((ok) => {
        const state = useSafetyStore.getState();
        if (ok && state.status === "emergency" && state.sosBroadcast === "denied") {
          void runEmergencyBroadcast(state.previousBroadcast);
        }
      });
    });
    return () => sub.remove();
  }, [status, sosBroadcast, runEmergencyBroadcast]);

  const performSos = useCallback(async () => {
    if (sosInFlightRef.current) return;
    sosInFlightRef.current = true;
    setSosBusy(true);
    heavyImpact();
    const previous = snapshotBroadcast();
    triggerSos(previous);
    const phones = getContactPhones();
    track("sos_triggered", { contacts: phones.length, app_contacts: linkedCount ?? 0, from_widget: fromWidgetRef.current });
    fromWidgetRef.current = false;

    recordSosContactAlert({ state: "sending" });
    void alertContactsSos().then((recipients) => {
      recordSosContactAlert(recipients === null ? { state: "pending" } : { state: "sent", recipients });
    });

    // The SMS never waits on sharing. Sharing auto-starts only when it needs no
    // prompt; otherwise the SOS screen offers the disclosure flow instead.
    if (phones.length === 0) {
      // No one to text: still grab a fix so app contacts see where the SOS came from.
      void getBestPosition(location).then((position) => {
        if (position) publishSosPosition(position);
      });
    }
    const deliveryPromise = phones.length > 0 ? sendAlertSms("sos") : null;
    void canAutoStartEmergencyBroadcast().then((canStart) => {
      if (useSafetyStore.getState().status !== "emergency") return;
      if (canStart) void runEmergencyBroadcast(previous);
      else recordSosBroadcast("needsSetup");
    });

    if (deliveryPromise) {
      const delivery = await deliveryPromise;
      recordSosDelivery(delivery);
      track("sos_sms_result", { outcome: delivery.outcome, has_location: delivery.hasLocation });
      if (delivery.outcome === "failed") errorNotification();
    }
    sosInFlightRef.current = false;
    setSosBusy(false);
  }, [linkedCount, location, recordSosBroadcast, recordSosContactAlert, recordSosDelivery, runEmergencyBroadcast, sendAlertSms, triggerSos]);

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
    useQuickSosStore.getState().setArming(false);
  }, []);

  const beginSosCountdown = useCallback(() => {
    if (sosInFlightRef.current || countdownTimerRef.current) return;
    // Links still loading (e.g. a cold start from the widget) count as reachable; the server decides.
    if (getContactPhones().length === 0 && linkedCount === 0) {
      showNoContactsAlert();
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    useQuickSosStore.getState().setArming(true);
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
  }, [clearCountdown, linkedCount, performSos, showNoContactsAlert]);

  // A widget tap asks for SOS: start the same cancellable countdown as holding the button.
  useEffect(() => {
    const arm = () => {
      if (!useQuickSosStore.getState().consume() || useSafetyStore.getState().status === "emergency") return;
      fromWidgetRef.current = true;
      beginSosCountdown();
    };
    // Picks up a request made before this screen mounted (cold start from the widget).
    const pending = setTimeout(arm, 0);
    const unsubscribe = useQuickSosStore.subscribe((state, prev) => {
      if (state.requestedAt !== null && state.requestedAt !== prev.requestedAt) arm();
    });
    return () => {
      clearTimeout(pending);
      unsubscribe();
    };
  }, [beginSosCountdown]);

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

  // Starts sharing directly when already consented, else shows the disclosure first.
  const handleEnableSosSharing = useCallback(async () => {
    if (broadcastBusy) return;
    if (await canAutoStartEmergencyBroadcast()) {
      void runEmergencyBroadcast(useSafetyStore.getState().previousBroadcast);
      return;
    }
    setDisclosureFor("sos");
  }, [broadcastBusy, runEmergencyBroadcast]);

  const handleFixBackground = useCallback(() => {
    if (hasAcceptedBackgroundDisclosure()) void requestBackground();
    else setDisclosureFor("readiness");
  }, [requestBackground]);

  // One disclosure serves the SOS, readiness and live-sharing flows; whichever asked gets the answer.
  const handleDisclosureAccept = useCallback(() => {
    if (share.disclosureVisible) {
      share.onDisclosureAccept();
      return;
    }
    const purpose = disclosureFor;
    setDisclosureFor(null);
    if (purpose === "sos" && useSafetyStore.getState().status === "emergency") {
      void runEmergencyBroadcast(useSafetyStore.getState().previousBroadcast).then(() => refreshReadiness());
    } else if (purpose === "readiness") {
      void requestBackground();
    }
  }, [disclosureFor, refreshReadiness, requestBackground, runEmergencyBroadcast, share]);

  const handleDisclosureDecline = useCallback(() => {
    if (share.disclosureVisible) share.onDisclosureDecline();
    setDisclosureFor(null);
  }, [share]);

  const handleStart = useCallback((duration: number) => {
    setScheduleFailed(false);
    startTimer(duration);
    track("check_in_started", { duration_minutes: Math.round(duration / 60) });
    heavyImpact();
  }, [startTimer]);

  const handleExtend = useCallback(() => {
    extendTimer(60 * 60);
    heavyImpact();
  }, [extendTimer]);

  const handleCheckIn = useCallback(() => {
    stopTimer();
    track("check_in_completed");
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
    showAlert(t("safety.cancelTitle"), t("safety.cancelBody"), [
      { text: t("safety.cancelKeep"), style: "cancel" },
      {
        text: t("safety.cancelConfirm"),
        style: "destructive",
        onPress: async () => {
          if (!(await authorizeSosCancel(t("auth.nativeUnlockPrompt"), t("auth.nativeCancelLabel")))) return;
          if (useSafetyStore.getState().status !== "emergency") return;
          const { previousBroadcast, sosDelivery: delivered } = useSafetyStore.getState();
          const contactsAlerted = delivered?.outcome === "sent" || delivered?.outcome === "opened";
          cancelSos();
          resolveSosOnServer();
          track("sos_cancelled");
          successNotification();
          setSafeFollowUp(contactsAlerted && getContactPhones().length > 0);
          void restoreBroadcast(previousBroadcast);
        },
      },
    ]);
  }, [cancelSos, t]);

  const handleSendSafeMessage = useCallback(async () => {
    if (safeBusy) return;
    setSafeBusy(true);
    const phones = getContactPhones();
    const outcome = await composeSms(phones, t("safety.smsTemplateSafe"));
    setSafeBusy(false);
    if (outcome === "sent" || outcome === "opened") {
      setSafeFollowUp(false);
      addEvent({
        messageKey: outcome === "sent" ? "safety.eventSafeMessageSent" : "safety.eventSafeMessageOpened",
        messageParams: { count: phones.length },
        icon: "check",
        color: "teal",
      });
    } else if (outcome === "failed") {
      errorNotification();
    }
  }, [addEvent, safeBusy, t]);

  const smsStatusText = (delivery: SmsDelivery | null, keys: Record<SmsDelivery["outcome"], string>) =>
    delivery
      ? t(keys[delivery.outcome], { count: delivery.recipients, time: formatTime(delivery.at) })
      : null;

  const disclosure = (
    <BackgroundLocationDisclosure
      visible={disclosureFor !== null || share.disclosureVisible}
      onAccept={handleDisclosureAccept}
      onDecline={handleDisclosureDecline}
    />
  );

  if (status === "emergency") {
    const sosStatus = sosBusy
      ? t("sos.statusPreparing")
      : smsStatusText(sosDelivery, {
          sent: "sos.statusSent",
          opened: "sos.statusOpened",
          cancelled: "sos.statusCancelled",
          failed: "sos.statusFailed",
        });
    const sharingLive = sosBroadcast === "started" && broadcastRunning;
    const broadcastText = broadcastBusy || sosBroadcast === "starting"
      ? t("sos.broadcastStarting")
      : sharingLive
        ? t("sos.broadcastOn")
        : sosBroadcast === "denied"
          ? t("sos.broadcastDenied")
          : sosBroadcast === "needsSetup"
            ? t("sos.broadcastNeedsSetup")
            : sosBroadcast === "failed" || sosBroadcast === "started"
              ? t("sos.broadcastOff")
              : null;
    const broadcastDown =
      !broadcastBusy && sosBroadcast !== null && sosBroadcast !== "starting" && !sharingLive;
    // Permanently denied: the OS won't prompt again, so only system settings can fix it.
    const needsSystemSettings = sosBroadcast === "denied" && readiness.background === "blocked";
    const contactAlertText = !sosContactAlert
      ? null
      : sosContactAlert.state === "sending"
        ? t("sos.appAlertSending")
        : sosContactAlert.state === "pending"
          ? t("sos.appAlertPending")
          : sosContactAlert.recipients > 0
            ? t("sos.appAlertSent", { count: sosContactAlert.recipients })
            : t("sos.appAlertNone");
    const statusLines = [
      contactAlertText ? { text: contactAlertText } : null,
      sosStatus ? { text: sosStatus } : null,
      sosDelivery && !sosDelivery.hasLocation && !sosBusy ? { text: t("sos.noLocationIncluded"), muted: true } : null,
      broadcastText ? { text: broadcastText, muted: true } : null,
      { text: t("sos.callHint", { number: emergencyNumber }), muted: true },
    ].filter((line): line is { text: string; muted?: boolean } => line !== null);

    return (
      <>
        <EmergencyTakeover
          emergencyNumber={emergencyNumber}
          statusLines={statusLines}
          isOffline={isOffline}
          location={location}
          sharingLive={sharingLive}
          fixAge={location?.timestamp ? formatAge(now - location.timestamp, t) : null}
          sosBusy={sosBusy}
          sharingActionLabel={
            !broadcastDown
              ? null
              : needsSystemSettings
                ? t("sos.openSettings")
                : sosBroadcast === "failed"
                  ? t("sos.retryBroadcast")
                  : t("sos.enableSharing")
          }
          onCall={callEmergency}
          onResend={handleResendSos}
          onSharingAction={needsSystemSettings ? () => void Linking.openSettings() : handleEnableSosSharing}
          onCancel={handleCancelSos}
        />
        {disclosure}
      </>
    );
  }

  const missedStatus = smsStatusText(missedAlert, {
    sent: "safety.missedAlertSent",
    opened: "safety.missedAlertOpened",
    cancelled: "safety.missedAlertCancelled",
    failed: "safety.missedAlertFailed",
  });

  const notificationsOff = readiness.loaded && readiness.notifications !== "granted";
  const showNotificationWarning = status === "active" && (notificationsOff || scheduleFailed);

  const auraStatus: AuraStatus = isMissed ? "alert" : isActive || share.isBroadcasting ? "live" : "calm";
  const accent = auraStatusAccent[auraStatus];
  const statusLabel = isMissed
    ? t("safety.checkInMissed")
    : isActive
      ? t("safety.timerRunning")
      : share.isBroadcasting
        ? t("sharing.liveStatus", { count: share.activeRecipientCount })
        : t("safety.allClear");

  const plannedDuration = selectedDuration ?? defaultCheckInDuration;
  const appContacts = linkedCount ?? 0;

  const sosCaption = [
    appContacts > 0 ? t("safety.sosAppBody", { count: appContacts }) : null,
    phoneCount > 0 ? t("safety.sosBody", { count: phoneCount }) : appContacts > 0 ? null : t("safety.sosBodyNoContacts"),
  ].filter(Boolean).join(" ");
  const countdownBody = [
    appContacts > 0 ? t("sos.countdownApp", { count: appContacts }) : null,
    phoneCount > 0 ? t("sos.countdownBody", { count: phoneCount }) : null,
  ].filter(Boolean).join(" ");

  const contactsAlertAt = checkInEndsAt ? checkInEndsAt + CHECK_IN_ALERT_GRACE_MS : null;
  const missedContactsNote =
    appContacts > 0 && contactsAlertAt
      ? now < contactsAlertAt
        ? t("safety.missedContactsAt", { count: appContacts, time: formatTime(contactsAlertAt) })
        : t("safety.missedContactsAlerted", { count: appContacts })
      : null;

  const contacts = (incomingShares ?? [])
    .filter((s) => !(s.latitude === 0 && s.longitude === 0))
    .map((s) => ({ name: s.ownerName, latitude: s.latitude, longitude: s.longitude, stale: now - s.updatedAt > STALE_AFTER_MS }));

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView
        scrollEnabled={!mapTouched}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: tabBarInset + 24 }}
      >
        <SafetyMapHero
          height={insets.top + Math.round(width * 0.85)}
          topInset={insets.top}
          title={t("safety.title")}
          statusLabel={statusLabel}
          statusLive={auraStatus !== "calm"}
          palette={c}
          accent={accent}
          isDark={isDark}
          me={location ? { latitude: location.latitude, longitude: location.longitude } : null}
          contacts={contacts}
          onTouchActive={setMapTouched}
        />

        <View style={styles.chips}>
          {location ? <AuraChip label={formatCoords(location)} icon="mapPin" onPress={() => setCoordsOpen(true)} /> : null}
          {contacts.length > 0 ? <AuraChip label={t("home.sharingWithYou", { count: contacts.length })} icon="users" /> : null}
        </View>

        <View style={styles.body}>
          <View style={styles.actions}>
            <SosHoldButton
              progress={Math.min(1, sosHoldSeconds / SOS_HOLD_SECONDS)}
              label={sosHoldSeconds > 0 ? t("safety.keepHolding") : t("safety.holdSos")}
              palette={c}
              onPressIn={handleSosPressIn}
              onPressOut={clearHold}
              accessibilityLabel={t("safety.sosA11yLabel")}
              accessibilityHint={t("safety.sosA11yHint")}
              onAccessibilityActivate={beginSosCountdown}
            />
            <ActionButton
              icon="check"
              label={isActive || isMissed ? t("safety.imSafeShort") : t("safety.factorCheckIn")}
              palette={c}
              accent={accent}
              live={isActive}
              onPress={isActive || isMissed ? handleCheckIn : () => handleStart(plannedDuration)}
            />
            <ActionButton
              icon="users"
              label={t("tabs.share")}
              palette={c}
              accent={accent}
              live={share.isBroadcasting}
              onPress={() => void share.toggle()}
            />
            <ActionButton
              icon="phone"
              label={t("safety.callShort", { number: emergencyNumber })}
              palette={c}
              accent={accent}
              onPress={callEmergency}
            />
          </View>
          <Text style={[styles.caption, { color: c.textMuted, fontFamily: f.regular }]}>
            {sosCaption}
          </Text>

          {safeFollowUp && status === "idle" ? (
            <AuraCard tone="#3DDC97" style={styles.notice}>
              <View style={styles.noticeHead}>
                <Icon name="check" size={17} color="#3DDC97" strokeWidth={2.2} />
                <Text style={[styles.noticeTitle, { color: c.text, fontFamily: f.semibold }]}>{t("safety.safeFollowUpTitle")}</Text>
              </View>
              <Text style={[styles.noticeBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("safety.safeFollowUpBody")}</Text>
              <View style={styles.noticeButtons}>
                <AuraButton label={t("safety.safeFollowUpSend")} icon="messageCircle" size="md" loading={safeBusy} onPress={handleSendSafeMessage} />
                <AuraButton label={t("safety.safeFollowUpDismiss")} variant="ghost" size="md" onPress={() => setSafeFollowUp(false)} />
              </View>
            </AuraCard>
          ) : null}

          {showNotificationWarning ? (
            <AuraCard tone="#FFB547" style={styles.notice}>
              <View style={styles.noticeHead}>
                <Icon name="bell" size={17} color="#FFB547" strokeWidth={2} />
                <Text style={[styles.noticeTitle, { color: c.text, fontFamily: f.semibold }]}>
                  {scheduleFailed && !notificationsOff ? t("safety.notificationsScheduleFailed") : t("safety.notificationsOffTitle")}
                </Text>
              </View>
              {notificationsOff ? (
                <>
                  <Text style={[styles.noticeBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("safety.notificationsOffBody")}</Text>
                  <View style={styles.noticeButtons}>
                    <AuraButton
                      label={readiness.notifications === "blocked" ? t("safety.openSettings") : t("safety.actionTurnOn")}
                      variant="secondary"
                      size="md"
                      onPress={() => void fixNotifications()}
                    />
                  </View>
                </>
              ) : null}
            </AuraCard>
          ) : null}

          <AuraSection title={t("sharing.eyebrow")} />
          <LiveSharingCard
            isBroadcasting={share.isBroadcasting}
            busy={share.busy}
            mode={share.mode}
            activeRecipientCount={share.activeRecipientCount}
            shareDuration={share.shareDuration}
            accent={accent}
            onToggle={() => void share.toggle()}
            onModeChange={(next) => void share.changeMode(next)}
            onDurationChange={share.setShareDuration}
          />

          <SharingPeople
            isBroadcasting={share.isBroadcasting}
            location={location ? { latitude: location.latitude, longitude: location.longitude } : null}
            accent={accent}
          />

          <AuraSection title={t("safety.factorCheckIn")} />
          <CheckInCard
            state={isMissed ? "missed" : isActive ? "active" : "idle"}
            seconds={plannedDuration}
            endsAt={checkInEndsAt}
            presets={PRESETS.map((duration) => ({ duration, label: formatDurationLabel(duration, t) }))}
            plannedDuration={plannedDuration}
            plannedLabel={formatDurationLabel(plannedDuration, t)}
            accent={accent}
            missedBody={[t("safety.missedBody", { time: checkInEndsAt ? formatTime(checkInEndsAt) : "" }), missedContactsNote].filter(Boolean).join(" ")}
            activeBody={appContacts > 0 ? t("safety.autoAlertContacts", { count: appContacts }) : t("safety.autoAlert")}
            missedStatus={missedStatus}
            missedBusy={missedBusy}
            onSelectDuration={setSelectedDuration}
            onStart={() => handleStart(plannedDuration)}
            onCheckIn={handleCheckIn}
            onExtend={handleExtend}
            onSendMissedAlert={handleSendMissedAlert}
          />
          <SafetyReadinessChecklist
            readiness={readiness}
            emergency={emergency}
            onFixForeground={() => void fixForeground()}
            onFixBackground={handleFixBackground}
            onFixNotifications={() => void fixNotifications()}
            onFixContacts={() => router.push("/emergency-contacts")}
            onFixBattery={openBatterySettings}
            onCallEmergency={callEmergency}
          />
        </View>
      </ScrollView>

      <SosCountdownOverlay
        seconds={sosCountdown}
        body={countdownBody}
        onCancel={handleCancelCountdown}
        onSendNow={handleSendNow}
      />
      <LocationActionsSheet visible={coordsOpen} location={location} onClose={() => setCoordsOpen(false)} />
      {disclosure}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, paddingHorizontal: 16, marginTop: 4 },
  body: { paddingHorizontal: 20 },
  actions: { flexDirection: "row", marginTop: 26, marginHorizontal: -6 },
  caption: { fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 14, paddingHorizontal: 8 },
  notice: { marginTop: 18 },
  noticeHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  noticeTitle: { flex: 1, fontSize: 15 },
  noticeBody: { fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  noticeButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
});
