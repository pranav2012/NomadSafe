import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { BlurTargetView } from "expo-blur";
import { useNetworkState } from "expo-network";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { getCurrentPosition, getLastKnownPosition, requestForegroundPermission } from "@/modules/location";
import { GlassSurface, LiveDot, showAlert, useAura, useTabBarInset } from "@/atoms";
import { auraStatusAccent, type AuraStatus } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { useSettingsStore } from "@/features/settings";
import { isLocationBroadcastRunning, readBroadcastState, useSharingStore } from "@/features/location-sharing";
import {
  BackgroundLocationDisclosure,
  hasAcceptedBackgroundDisclosure,
} from "@/features/location-sharing/components/BackgroundLocationDisclosure";
import { ShareLocationSheet } from "@/features/location-sharing/components/ShareLocationSheet";
import { useBroadcastToggle } from "@/features/location-sharing/hooks/useBroadcastToggle";
import { useCircle } from "@/features/location-sharing/hooks/useCircle";
import {
  fetchEmergencyNumbers,
  readLastEmergencyNumbers,
  type EmergencyNumbers,
} from "@/features/safety/services/emergencyNumberService";
import {
  canAutoStartEmergencyBroadcast,
  getBestPosition,
  restoreBroadcast,
  snapshotBroadcast,
  startEmergencyBroadcast,
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
import { countReadinessIssues, useSafetyReadiness } from "@/features/safety/hooks/useSafetyReadiness";
import { EmergencyTakeover, SosCountdownOverlay } from "@/features/safety/components/EmergencyTakeover";
import { ReadinessSheet } from "@/features/safety/components/ReadinessSheet";
import { SafeArrivalSheet } from "@/features/safety/components/SafeArrivalSheet";
import { SafetyMap } from "@/features/safety/components/SafetyMap";
import { CircleRow, FixBanner, SafetyTile, SharingLiveCard, TimerLiveCard } from "@/features/safety/components/SafetyPanel";
import { SosHoldButton } from "@/features/safety/components/SosHoldButton";
import { isCheckInMissed, useSafetyStore, type ContactAlert } from "../store/safetyStore";
import { useSafetyIntentStore } from "../store/safetyIntentStore";
import { errorNotification, heavyImpact, lightImpact, successNotification } from "@/utils/haptics";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";

const PRESETS = [15 * 60, 30 * 60, 60 * 60, 2 * 60 * 60, 4 * 60 * 60, 8 * 60 * 60];

const SOS_HOLD_SECONDS = 2;
const SOS_CANCEL_WINDOW_SECONDS = 5;
const WARN = "#FFB547";
const READY = "#3DDC97";

type Translate = (key: string, params?: Record<string, string | number>) => string;
type Coords = { latitude: number; longitude: number; accuracy: number | null; timestamp: number | null };
type Sheet = "share" | "timer" | "readiness";

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

/** "Mia", "Mia and Leo", "Mia, Leo +2". */
function joinNames(names: string[], t: Translate) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return t("safety.twoNames", { a: names[0], b: names[1] });
  return t("safety.manyNames", { a: names[0], b: names[1], count: names.length - 2 });
}

/**
 * Safety tab: a full-screen map of you and the people sharing with you, the floating SOS button,
 * and a glass panel with what's running, Share location / Safe-arrival timer / Call, your circle,
 * and a banner when a phone setting needs fixing. While an SOS is active the whole tab becomes
 * the emergency takeover. Alerts reach the circle as push notifications from the server.
 */
export default function SafetyScreen() {
  const { c, f, isDark } = useAura();
  const { t, formatTime } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { height: windowHeight } = useWindowDimensions();
  const blurTarget = useRef<View>(null);

  const status = useSafetyStore((s) => s.status);
  const checkInEndsAt = useSafetyStore((s) => s.checkInEndsAt);
  const startTimer = useSafetyStore((s) => s.startTimer);
  const stopTimer = useSafetyStore((s) => s.stopTimer);
  const extendTimer = useSafetyStore((s) => s.extendTimer);
  const markCheckInMissed = useSafetyStore((s) => s.markCheckInMissed);
  const triggerSos = useSafetyStore((s) => s.triggerSos);
  const recordSosBroadcast = useSafetyStore((s) => s.recordSosBroadcast);
  const sosBroadcast = useSafetyStore((s) => s.sosBroadcast);
  const sosContactAlert = useSafetyStore((s) => s.sosContactAlert);
  const recordSosContactAlert = useSafetyStore((s) => s.recordSosContactAlert);
  const cancelSos = useSafetyStore((s) => s.cancelSos);

  const defaultCheckInDuration = useSettingsStore((s) => s.defaultCheckInDuration);
  const share = useBroadcastToggle();
  const setBroadcasting = useSharingStore((s) => s.setBroadcasting);
  const circle = useCircle();
  const alertCount = circle.alertCount;

  const [now, setNow] = useState(() => Date.now());
  const [location, setLocation] = useState<Coords | null>(() => readLastKnownFix());
  const [sosHoldSeconds, setSosHoldSeconds] = useState(0);
  const [emergency, setEmergency] = useState<EmergencyNumbers | null>(() => readLastEmergencyNumbers());
  const [scheduleFailed, setScheduleFailed] = useState(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [alertBusy, setAlertBusy] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastRunning, setBroadcastRunning] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [disclosureFor, setDisclosureFor] = useState<"readiness" | "sos" | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [broadcastInfo, setBroadcastInfo] = useState(() => readBroadcastState());

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
  const issueCount = countReadinessIssues(readiness);

  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sosInFlightRef = useRef(false);
  const fromWidgetRef = useRef(false);

  // Home's "Get home safe" card asks for the timer sheet.
  useEffect(() => {
    const check = () => {
      if (!useSafetyIntentStore.getState().openTimer) return;
      useSafetyIntentStore.getState().consume();
      if (useSafetyStore.getState().status !== "active") setSheet("timer");
    };
    const first = setTimeout(check, 0);
    const unsubscribe = useSafetyIntentStore.subscribe(check);
    return () => {
      clearTimeout(first);
      unsubscribe();
    };
  }, []);

  // The OS task may have been stopped while the app was away (expiry, permission revoked).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      isLocationBroadcastRunning().then((running) => {
        if (active && running !== useSharingStore.getState().isBroadcasting) setBroadcasting(running);
      });
      setBroadcastInfo(readBroadcastState());
      return () => {
        active = false;
      };
    }, [setBroadcasting]),
  );

  useEffect(() => {
    const refresh = setTimeout(() => setBroadcastInfo(readBroadcastState()), 0);
    if (!share.isBroadcasting) return () => clearTimeout(refresh);
    const id = setInterval(() => setBroadcastInfo(readBroadcastState()), 15_000);
    return () => {
      clearTimeout(refresh);
      clearInterval(id);
    };
  }, [share.isBroadcasting]);

  // Coarse clock while a timer or SOS runs, plus an exact tick when the timer runs out; the
  // per-second countdown lives in TimerLiveCard so the screen (and its map) doesn't re-render.
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

  // Get a location fix for the map and persist it for an offline SOS.
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

  // "Sharing" is shown during an SOS only while the OS location task is really running.
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

  const openCircle = useCallback(() => {
    setSheet(null);
    router.push("/circle");
  }, [router]);

  const showEmptyCircleAlert = useCallback(() => {
    errorNotification();
    showAlert(t("safety.emptyCircleTitle"), t("safety.emptyCircleBody", { number: emergencyNumber }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("sos.callEmergency", { number: emergencyNumber }), onPress: callEmergency },
      { text: t("circle.addPerson"), onPress: openCircle },
    ]);
  }, [callEmergency, emergencyNumber, openCircle, t]);

  // Records the push outcome, including one that lands after reconnecting while the SOS is still on.
  const sendSosPush = useCallback(async () => {
    recordSosContactAlert({ state: "sending" });
    const recipients = await alertContactsSos((late) => {
      if (useSafetyStore.getState().status === "emergency") recordSosContactAlert({ state: "sent", recipients: late });
    });
    const outcome: ContactAlert = recipients === null ? { state: "pending" } : { state: "sent", recipients };
    if (useSafetyStore.getState().status === "emergency") recordSosContactAlert(outcome);
  }, [recordSosContactAlert]);

  // Starts emergency sharing; undoes it if the SOS was cancelled meanwhile.
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

  const performSos = useCallback(() => {
    if (sosInFlightRef.current) return;
    sosInFlightRef.current = true;
    heavyImpact();
    const previous = snapshotBroadcast();
    triggerSos(previous);
    track("sos_triggered", { contacts: 0, app_contacts: alertCount, from_widget: fromWidgetRef.current });
    fromWidgetRef.current = false;

    void sendSosPush().finally(() => {
      sosInFlightRef.current = false;
    });
    // A fresh fix, so the circle sees where the SOS came from even if live sharing can't start.
    void getBestPosition(location).then((position) => {
      if (!position) return;
      setLocation({ latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy, timestamp: position.timestamp });
      publishSosPosition(position);
    });
    // Sharing auto-starts only when it needs no prompt; otherwise the SOS screen offers the disclosure flow.
    void canAutoStartEmergencyBroadcast().then((canStart) => {
      if (useSafetyStore.getState().status !== "emergency") return;
      if (canStart) void runEmergencyBroadcast(previous);
      else recordSosBroadcast("needsSetup");
    });
  }, [alertCount, location, recordSosBroadcast, runEmergencyBroadcast, sendSosPush, triggerSos]);

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
    // While the circle is still loading (e.g. a cold start from the widget) it counts as reachable; the server decides.
    if (circle.loaded && alertCount === 0) {
      showEmptyCircleAlert();
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
        performSos();
        return;
      }
      setSosCountdown(remaining);
      lightImpact();
    }, 1000);
  }, [alertCount, circle.loaded, clearCountdown, performSos, showEmptyCircleAlert]);

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
    performSos();
  }, [clearCountdown, performSos]);

  const handleAlertAgain = useCallback(async () => {
    if (alertBusy) return;
    setAlertBusy(true);
    await sendSosPush();
    setAlertBusy(false);
  }, [alertBusy, sendSosPush]);

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
    if (hasAcceptedBackgroundDisclosure()) {
      void requestBackground();
      return;
    }
    setSheet(null);
    setDisclosureFor("readiness");
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

  const plannedDuration = selectedDuration ?? defaultCheckInDuration;

  const handleStartTimer = useCallback(() => {
    setSheet(null);
    setScheduleFailed(false);
    startTimer(plannedDuration);
    track("check_in_started", { duration_minutes: Math.round(plannedDuration / 60) });
    heavyImpact();
  }, [plannedDuration, startTimer]);

  const handleExtend = useCallback(() => {
    extendTimer(60 * 60);
    heavyImpact();
  }, [extendTimer]);

  const handleCheckIn = useCallback(() => {
    stopTimer();
    track("check_in_completed");
    successNotification();
  }, [stopTimer]);

  const handleStartSharing = useCallback((recipients: number) => {
    setSheet(null);
    void share.start(recipients);
  }, [share]);

  const handleStopSharing = useCallback(() => {
    setSheet(null);
    void share.stop();
  }, [share]);

  const handleCancelSos = useCallback(() => {
    showAlert(t("safety.cancelTitle"), t("safety.cancelBody"), [
      { text: t("safety.cancelKeep"), style: "cancel" },
      {
        text: t("safety.cancelConfirm"),
        style: "destructive",
        onPress: async () => {
          if (!(await authorizeSosCancel(t("auth.nativeUnlockPrompt"), t("auth.nativeCancelLabel")))) return;
          if (useSafetyStore.getState().status !== "emergency") return;
          const { previousBroadcast } = useSafetyStore.getState();
          cancelSos();
          // Tells everyone who got the SOS push that you're safe.
          resolveSosOnServer();
          track("sos_cancelled");
          successNotification();
          void restoreBroadcast(previousBroadcast);
        },
      },
    ]);
  }, [cancelSos, t]);

  const disclosure = (
    <BackgroundLocationDisclosure
      visible={disclosureFor !== null || share.disclosureVisible}
      onAccept={handleDisclosureAccept}
      onDecline={handleDisclosureDecline}
    />
  );

  if (status === "emergency") {
    const sharingLive = sosBroadcast === "started" && broadcastRunning;
    const broadcastText = broadcastBusy || sosBroadcast === "starting"
      ? t("sos.broadcastStarting")
      : sharingLive
        ? t("sos.broadcastOn")
        : sosBroadcast === "denied"
          ? t("sos.broadcastDenied")
          : sosBroadcast === "needsSetup"
            ? t("sos.sharingNeedsSetup")
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
        ? t("sos.circleAlertSending")
        : sosContactAlert.state === "pending"
          ? t("sos.circleAlertPending")
          : sosContactAlert.recipients > 0
            ? t("sos.circleAlertSent", { count: sosContactAlert.recipients })
            : t("sos.circleAlertNone");
    const statusLines = [
      contactAlertText ? { text: contactAlertText } : null,
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
          alertBusy={alertBusy}
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
          onAlertAgain={handleAlertAgain}
          onSharingAction={needsSystemSettings ? () => void Linking.openSettings() : handleEnableSosSharing}
          onCancel={handleCancelSos}
        />
        {disclosure}
      </>
    );
  }

  const notificationsOff = readiness.loaded && readiness.notifications !== "granted";
  const circleEmpty = circle.loaded && alertCount === 0;
  const setupNeeded = circleEmpty || issueCount > 0;

  const auraStatus: AuraStatus = isMissed ? "alert" : isActive || share.isBroadcasting ? "live" : "calm";
  const accent = auraStatusAccent[auraStatus];
  const statusLabel = isMissed
    ? t("safety.statusMissed")
    : isActive
      ? t("safety.timerRunning")
      : share.isBroadcasting
        ? t("safety.statusSharing")
        : setupNeeded
          ? t("safety.statusSetup")
          : t("safety.allClear");
  const statusDot = auraStatus !== "calm" ? accent : setupNeeded ? WARN : READY;

  const countdownBody = alertCount > 0 ? t("sos.countdownCircle", { count: alertCount }) : t("sos.countdownCircleUnknown");

  const contactsAlertAt = checkInEndsAt ? checkInEndsAt + CHECK_IN_ALERT_GRACE_MS : null;
  const timerBody = isMissed
    ? alertCount > 0 && contactsAlertAt
      ? now < contactsAlertAt
        ? t("safety.missedCircleAt", { count: alertCount, time: formatTime(contactsAlertAt) })
        : t("safety.missedCircleAlerted", { count: alertCount })
      : t("safety.missedNoCircle")
    : alertCount > 0
      ? t("safety.timerAlertsCircle", { count: alertCount })
      : t("safety.timerNoCircleShort");
  const timerTitle = isMissed
    ? t("safety.overdueBy")
    : t("safety.checkInBy", { time: checkInEndsAt ? formatTime(checkInEndsAt) : "" });
  const timerWarning = (isActive || isMissed) && (notificationsOff || scheduleFailed)
    ? (scheduleFailed && !notificationsOff ? t("safety.notificationsScheduleFailed") : t("safety.notificationsOffShort"))
    : null;

  const seesYou = circle.people.filter((p) => p.seesYou).map((p) => p.name);
  const shareEndsLabel = broadcastInfo.expiresAt ? t("sharing.endsAt", { time: formatTime(broadcastInfo.expiresAt) }) : null;

  const mapPeople = circle.sharingWithYou.flatMap((p) =>
    p.location ? [{ name: p.name, latitude: p.location.latitude, longitude: p.location.longitude, stale: p.location.stale }] : [],
  );
  const headerHeight = insets.top + 56;
  const panelBottom = tabBarInset;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <BlurTargetView ref={blurTarget} style={StyleSheet.absoluteFill}>
        <SafetyMap
          topInset={headerHeight}
          bottomInset={panelBottom + panelHeight + 40}
          palette={c}
          accent={accent}
          isDark={isDark}
          me={location ? { latitude: location.latitude, longitude: location.longitude } : null}
          people={mapPeople}
        />
      </BlurTargetView>

      <View style={[styles.header, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Text accessibilityRole="header" style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
          {t("safety.title")}
        </Text>
        <View style={[styles.pill, { backgroundColor: c.card, borderColor: c.hairline }]} accessibilityLiveRegion="polite">
          <LiveDot color={statusDot} active={auraStatus !== "calm"} size={7} />
          <Text style={[styles.pillText, { color: c.text, fontFamily: f.medium }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={[styles.sos, { bottom: panelBottom + panelHeight + 14 }]} pointerEvents="box-none">
        <SosHoldButton
          progress={Math.min(1, sosHoldSeconds / SOS_HOLD_SECONDS)}
          label={sosHoldSeconds > 0 ? t("safety.keepHolding") : t("safety.holdForSos")}
          palette={c}
          onPressIn={handleSosPressIn}
          onPressOut={clearHold}
          accessibilityLabel={t("safety.sosA11yLabel")}
          accessibilityHint={t("safety.sosHoldHint")}
          onAccessibilityActivate={beginSosCountdown}
        />
      </View>

      <View
        style={[styles.panel, { bottom: panelBottom, maxHeight: windowHeight * 0.62 }]}
        onLayout={(e) => setPanelHeight(Math.round(e.nativeEvent.layout.height))}
      >
        <GlassSurface isDark={isDark} radius={30} blurTarget={blurTarget} />
        {Platform.OS === "android" ? <View style={[StyleSheet.absoluteFill, styles.panelTint, { backgroundColor: `${c.bg}8C` }]} /> : null}
        <View style={[StyleSheet.absoluteFill, styles.panelBorder, { borderColor: c.hairline }]} pointerEvents="none" />
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={styles.panelScroll} contentContainerStyle={styles.panelBody}>
          {(isActive || isMissed) && checkInEndsAt ? (
            <TimerLiveCard
              missed={isMissed}
              endsAt={checkInEndsAt}
              accent={accent}
              title={timerTitle}
              body={timerWarning ? `${timerBody} ${timerWarning}` : timerBody}
              onSafe={handleCheckIn}
              onExtend={handleExtend}
            />
          ) : null}
          {share.isBroadcasting ? (
            <SharingLiveCard
              accent={auraStatusAccent.live}
              title={seesYou.length > 0 ? t("sharing.liveWith", { names: joinNames(seesYou, t) }) : t("sharing.liveNoOne")}
              body={shareEndsLabel ?? t("sharing.noEnd")}
              error={broadcastInfo.lastError ? t("sharing.publishFailed") : null}
              busy={share.busy}
              onManage={() => setSheet("share")}
              onStop={handleStopSharing}
            />
          ) : null}

          <View style={styles.tiles}>
            <SafetyTile
              icon="mapPin"
              label={t("safety.tileShare")}
              sub={share.isBroadcasting ? t("safety.tileLive") : t("safety.tileOff")}
              live={share.isBroadcasting}
              accent={auraStatusAccent.live}
              onPress={() => setSheet("share")}
            />
            <SafetyTile
              icon="clock"
              label={t("safety.tileTimer")}
              sub={
                isMissed
                  ? t("safety.tileMissed")
                  : isActive && checkInEndsAt
                    ? t("safety.tileUntil", { time: formatTime(checkInEndsAt) })
                    : t("safety.tileTimerSub")
              }
              live={isActive || isMissed}
              accent={accent}
              onPress={() => setSheet("timer")}
            />
            <SafetyTile
              icon="phone"
              label={t("safety.tileCall", { number: emergencyNumber })}
              sub={emergency?.countryName ?? t("safety.tileCallSub")}
              accent={accent}
              tone={auraStatusAccent.alert}
              onPress={callEmergency}
            />
          </View>

          <CircleRow people={circle.people} alertCount={circle.loaded ? alertCount : 1} onPress={openCircle} />
          {issueCount > 0 ? <FixBanner count={issueCount} onPress={() => setSheet("readiness")} /> : null}
        </ScrollView>
      </View>

      <ShareLocationSheet
        visible={sheet === "share"}
        onClose={() => setSheet(null)}
        people={circle.people}
        isBroadcasting={share.isBroadcasting}
        busy={share.busy}
        accent={auraStatusAccent.live}
        duration={share.shareDuration}
        endsAtLabel={shareEndsLabel}
        onDurationChange={share.setShareDuration}
        onToggleSeesYou={circle.setSeesYou}
        onStart={handleStartSharing}
        onStop={handleStopSharing}
        onAddPeople={openCircle}
      />
      <SafeArrivalSheet
        visible={sheet === "timer"}
        onClose={() => setSheet(null)}
        presets={PRESETS.map((duration) => ({ duration, label: formatDurationLabel(duration, t) }))}
        selected={plannedDuration}
        formatTime={formatTime}
        circleEmpty={circleEmpty}
        onSelect={setSelectedDuration}
        onStart={handleStartTimer}
        onAddPeople={openCircle}
      />
      <ReadinessSheet
        visible={sheet === "readiness"}
        onClose={() => setSheet(null)}
        readiness={readiness}
        onFixForeground={() => void fixForeground()}
        onFixBackground={handleFixBackground}
        onFixNotifications={() => void fixNotifications()}
        onFixBattery={openBatterySettings}
      />
      <SosCountdownOverlay
        seconds={sosCountdown}
        body={countdownBody}
        onCancel={handleCancelCountdown}
        onSendNow={handleSendNow}
      />
      {disclosure}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { position: "absolute", left: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flexShrink: 1, fontSize: 30, letterSpacing: -0.9 },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontSize: 12.5 },
  sos: { position: "absolute", right: 18 },
  panel: { position: "absolute", left: 10, right: 10, borderRadius: 30, overflow: "hidden" },
  panelTint: { borderRadius: 30 },
  panelBorder: { borderRadius: 30, borderWidth: StyleSheet.hairlineWidth },
  panelScroll: { flexGrow: 0 },
  panelBody: { padding: 12 },
  tiles: { flexDirection: "row", gap: 8 },
});
