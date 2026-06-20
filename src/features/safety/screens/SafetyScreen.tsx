import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as SMS from "expo-sms";
import { StatusBar } from "expo-status-bar";
import { Icon } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { NomadButton } from "@/components/nomad/Button";
import { Stamp } from "@/components/nomad/Stamp";
import { TravelMap } from "@/components/nomad/TravelMap";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useSafetyStore, type SafetyTrustedContact } from "../store/safetyStore";
import { heavyImpact, successNotification } from "@/utils/haptics";

const PRESETS = [
  { label: "30 min", duration: 30 * 60, sub: "Quick" },
  { label: "1 hr", duration: 60 * 60, sub: "Walk" },
  { label: "2 hr", duration: 2 * 60 * 60, sub: "Hike" },
  { label: "4 hr", duration: 4 * 60 * 60, sub: "Bus" },
];

function useNowTick() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const id = setInterval(update, 1000);
    update();
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function SafetyScreen() {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const nowTick = useNowTick();

  const status = useSafetyStore((s) => s.status);
  const checkInEndsAt = useSafetyStore((s) => s.checkInEndsAt);
  const startTimer = useSafetyStore((s) => s.startTimer);
  const stopTimer = useSafetyStore((s) => s.stopTimer);
  const extendTimer = useSafetyStore((s) => s.extendTimer);
  const triggerSos = useSafetyStore((s) => s.triggerSos);
  const cancelSos = useSafetyStore((s) => s.cancelSos);
  const storeContacts = useSafetyStore((s) => s.trustedContacts);
  const setStoreContacts = useSafetyStore((s) => s.setTrustedContacts);
  const events = useSafetyStore((s) => s.events);
  const lastTriggeredAt = useSafetyStore((s) => s.lastTriggeredAt);

  const trips = useTripsStore((s) => s.trips);
  const activeTripId = useTripsStore((s) => s.activeTripId);
  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? trips[0] ?? null;

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [sosHoldSeconds, setSosHoldSeconds] = useState(0);

  // Sync emergency contacts from onboarding storage into safety store.
  useEffect(() => {
    const contacts = emergencyContactsStorage.get();
    const mapped: SafetyTrustedContact[] = contacts.map((c) => ({
      id: c.id,
      name: c.name,
      relation: c.phone ? undefined : "Trusted",
    }));
    if (JSON.stringify(mapped) !== JSON.stringify(storeContacts)) {
      setStoreContacts(mapped);
    }
  }, [setStoreContacts, storeContacts]);

  // Live countdown.
  useEffect(() => {
    const tick = () => {
      if (status !== "active" || !checkInEndsAt) {
        setSecondsLeft(0);
        return;
      }
      setSecondsLeft(Math.max(0, Math.floor((checkInEndsAt - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, checkInEndsAt]);

  // Get location for safety context.
  useEffect(() => {
    let mounted = true;
    async function fetchLocation() {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== Location.PermissionStatus.GRANTED) return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (mounted) {
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    }
    fetchLocation();
    return () => { mounted = false; };
  }, []);

  const formatCountdown = useCallback((totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, []);

  const isActive = status === "active";
  const destinationName = activeTrip?.destinations[0] ?? t("safety.fallbackLocation");

  const handleStart = useCallback((duration: number) => {
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

  const handleTriggerSos = useCallback(async () => {
    triggerSos();
    heavyImpact();

    const contacts = emergencyContactsStorage.get();
    const phones = contacts.map((c) => c.phone).filter(Boolean) as string[];
    const body = location
      ? `SOS from NomadSafe. Location: https://maps.google.com/?q=${location.latitude},${location.longitude}`
      : "SOS from NomadSafe. I need help.";

    if (phones.length > 0 && await SMS.isAvailableAsync()) {
      await SMS.sendSMSAsync(phones, body);
    }
  }, [triggerSos, location]);

  const handleCancelSos = useCallback(() => {
    Alert.alert(t("safety.cancelTitle"), t("safety.cancelBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("safety.cancelConfirm"), style: "destructive", onPress: cancelSos },
    ]);
  }, [cancelSos, t]);

  const trustedContacts = storeContacts.length > 0
    ? storeContacts
    : [
        { id: "add", name: t("safety.addContact"), relation: "+", color: theme.inkMuted },
      ];

  const sensors = useMemo(() => [
    {
      icon: "mapPin" as const,
      title: t("safety.locationSensor"),
      sub: t("safety.locationNormal"),
      tint: theme.tealSoft,
      color: theme.teal,
      on: true,
    },
    {
      icon: "trendUp" as const,
      title: t("safety.motionSensor"),
      sub: t("safety.motionIdle"),
      tint: theme.skySoft,
      color: theme.sky,
      on: true,
    },
    {
      icon: "bell" as const,
      title: t("safety.smsFallback"),
      sub: t("safety.smsVerified", { count: storeContacts.length }),
      tint: theme.mustardSoft,
      color: theme.mustard,
      on: storeContacts.length > 0,
    },
    {
      icon: "wifi" as const,
      title: t("safety.offlineSensor"),
      sub: t("safety.offlineBody"),
      tint: theme.stampSoft,
      color: theme.stamp,
      on: true,
    },
  ], [storeContacts.length, t, theme]);

  const safetyScore = useMemo(() => {
    let score = 92;
    if (storeContacts.length === 0) score -= 20;
    if (!location) score -= 8;
    return Math.max(40, score);
  }, [storeContacts.length, location]);

  const elapsedSec = lastTriggeredAt ? Math.floor((nowTick - lastTriggeredAt) / 1000) : 0;
  const liveLog = useMemo(() => [
    { t: "0:00", m: t("sos.logTriggered"), done: true },
    { t: "0:02", m: t("sos.logSms"), done: true },
    { t: "0:04", m: t("sos.logStream"), done: true },
    ...(storeContacts.length > 0 ? [{ t: "0:45", m: t("sos.logAck", { name: storeContacts[0].name }), done: true }] : []),
    { t: formatCountdown(elapsedSec), m: t("sos.logListening"), done: false },
  ], [elapsedSec, storeContacts, t, formatCountdown]);

  if (status === "emergency") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.stamp }}>
        <StatusBar style="light" />
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.emergencyScroll} showsVerticalScrollIndicator={false}>
            <View style={{ paddingHorizontal: 22, paddingTop: 16 }}>
              <Text style={styles.emergencyEyebrow}>{t("sos.codeRed")}</Text>
              <Text style={styles.emergencyTitle}>{t("sos.helpOnTheWay")}</Text>
              <Text style={styles.emergencySub}>
                {t("sos.contactsNotified", { count: storeContacts.length })}
                {"\n"}
                {t("sos.policeFallback")}
              </Text>
            </View>

            <View style={styles.pulseWrap}>
              <View style={[styles.pulseRing, { borderColor: "rgba(255,255,255,0.4)" }]} />
              <View style={styles.pulseCore}>
                <Icon name="shield" size={60} color="#fff" strokeWidth={1.5} />
              </View>
            </View>

            <NomadCard theme={theme} style={[styles.logCard, { backgroundColor: "rgba(255,255,255,0.1)", borderColor: "transparent" }]}>
              <Text style={styles.logTitle}>{t("sos.liveBroadcast", { duration: formatCountdown(elapsedSec) })}</Text>
              {liveLog.map((e, i) => (
                <View key={i} style={styles.logRow}>
                  <Text style={styles.logTime}>{e.t}</Text>
                  <View style={[styles.logDot, e.done ? { backgroundColor: "rgba(255,255,255,0.9)" } : null]}>
                    {e.done ? <Icon name="check" size={9} color={theme.stamp} strokeWidth={3} /> : <View style={styles.logDotPulse} />}
                  </View>
                  <Text style={[styles.logMessage, { opacity: e.done ? 0.92 : 1 }]}>{e.m}</Text>
                </View>
              ))}
            </NomadCard>

            <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
              <View style={{ borderRadius: nomad.radii.xl, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}>
                <TravelMap
                  theme={theme}
                  dark={isDark}
                  pins={[{ x: 265, y: 160, type: "user", initial: t("safety.youInitial"), color: theme.stamp, pulse: true, name: t("sos.broadcasting") }]}
                  height={160}
                />
              </View>
            </View>

            <View style={styles.emergencyActions}>
              <Pressable
                onPress={() => {
                  const url = location
                    ? `tel:113`
                    : "tel:113";
                  Linking.openURL(url).catch(() => {});
                }}
                style={styles.emergencySecondary}
              >
                <Icon name="phone" size={18} color="#fff" />
                <Text style={styles.emergencySecondaryText}>{t("sos.callEmergency")}</Text>
              </Pressable>
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
            <View style={[styles.pill, { backgroundColor: isActive ? theme.mustardSoft : theme.tealSoft }]}>
              <View style={[styles.pillDot, { backgroundColor: isActive ? theme.mustard : theme.teal }]} />
              <Text style={[styles.pillText, { color: isActive ? theme.mustard : theme.teal }]}>
                {isActive ? t("safety.timerRunning") : t("safety.allClear")}
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
                {t("safety.scoreBody", { destination: destinationName })}
              </Text>
            </View>
            <View style={[styles.heroFooter, { borderTopColor: "rgba(255,255,255,0.18)" }]}>
              {[
                { l: t("safety.crime"), v: t("safety.low"), c: "#9FD4B8" },
                { l: t("safety.health"), v: t("safety.low"), c: "#9FD4B8" },
                { l: t("safety.weather"), v: t("safety.ok"), c: "#E8D29A" },
                { l: t("safety.political"), v: t("safety.calm"), c: "#9FD4B8" },
              ].map((s, i) => (
                <View key={i} style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>{s.l}</Text>
                  <Text style={[styles.heroStatValue, { color: s.c }]}>{s.v}</Text>
                </View>
              ))}
            </View>
          </NomadCard>

          <View style={styles.countdownWrap}>
            <View style={{ position: "relative", width: 260, height: 260 }}>
              <View style={StyleSheet.absoluteFill}>
                <Icon name="clock" size={260} color="transparent" />
              </View>
              <View style={styles.countdownCenter}>
                <Text style={[styles.countdownEyebrow, { color: theme.inkMuted }]}>
                  {isActive ? t("safety.checkInWithin") : t("safety.startCheckIn")}
                </Text>
                <Text style={[styles.countdownValue, { color: theme.inkDeep }]}>
                  {isActive ? formatCountdown(secondsLeft) : "00:00"}
                </Text>
                <Text style={[styles.countdownSub, { color: theme.inkSoft }]}>
                  {isActive ? t("safety.autoAlert") : t("safety.setTarget")}
                </Text>
              </View>
            </View>
          </View>

          {!isActive && (
            <View style={styles.presets}>
              {PRESETS.map((p) => (
                <Pressable
                  key={p.duration}
                  onPress={() => handleStart(p.duration)}
                  style={({ pressed }) => [
                    styles.preset,
                    { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <Text style={[styles.presetLabel, { color: theme.inkDeep }]}>{p.label}</Text>
                  <Text style={[styles.presetSub, { color: theme.inkMuted }]}>{p.sub}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.actions}>
            {!isActive ? (
              <>
                <NomadButton theme={theme} variant="teal" full icon={<Icon name="clock" size={18} color="#fff" />} onPress={() => handleStart(2 * 60 * 60)}>
                  {t("safety.startTwoHour")}
                </NomadButton>
                <View style={styles.actionRow}>
                  <NomadButton theme={theme} variant="ghost" full icon={<Icon name="plus" size={16} />} onPress={() => handleStart(30 * 60)}>
                    {t("safety.customTimer")}
                  </NomadButton>
                  <NomadButton theme={theme} variant="ghost" full icon={<Icon name="mapPin" size={16} />} onPress={() => handleStart(4 * 60 * 60)}>
                    {t("safety.geofenceArrival")}
                  </NomadButton>
                </View>
              </>
            ) : (
              <>
                <NomadButton theme={theme} variant="teal" full icon={<Icon name="check" size={18} color="#fff" />} onPress={handleCheckIn}>
                  {t("safety.imSafe")}
                </NomadButton>
                <NomadButton theme={theme} variant="ghost" full icon={<Icon name="plus" size={16} />} onPress={handleExtend}>
                  {t("safety.extendOneHour")}
                </NomadButton>
              </>
            )}
          </View>

          <NomadCard theme={theme} style={[styles.sosCard, { backgroundColor: isDark ? "rgba(224,96,68,0.08)" : theme.stampSoft, borderColor: theme.stamp, borderStyle: "dashed" }]}>
            <View style={styles.sosRow}>
              <Pressable
                onPressIn={() => {
                  setSosHoldSeconds(0);
                  const start = Date.now();
                  const id = setInterval(() => {
                    const held = (Date.now() - start) / 1000;
                    setSosHoldSeconds(held);
                    if (held >= 2) {
                      clearInterval(id);
                      handleTriggerSos();
                    }
                  }, 100);
                }}
                onPressOut={() => setSosHoldSeconds(0)}
                style={styles.sosButton}
              >
                <Text style={styles.sosButtonText}>SOS</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sosTitle, { color: theme.stamp }]}>{t("safety.holdForEmergency")}</Text>
                <Text style={[styles.sosBody, { color: theme.inkSoft }]}>
                  {t("safety.sosBody", { count: storeContacts.length })}
                </Text>
              </View>
            </View>
            {sosHoldSeconds > 0 && (
              <View style={styles.sosProgress}>
                <View style={[styles.sosProgressFill, { width: `${Math.min(100, (sosHoldSeconds / 2) * 100)}%`, backgroundColor: theme.stamp }]} />
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
                      <Text style={[styles.timelineMessage, { color: theme.inkDeep }]}>{e.message}</Text>
                      <Text style={[styles.timelineTime, { color: theme.inkMuted }]}>{e.timeLabel}</Text>
                    </View>
                    <Text style={[styles.timelineDay, { color: theme.inkMuted }]}>{e.dayLabel}</Text>
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

          <View style={styles.sectionRow}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("safety.trustedContacts")}</Text>
            <View style={[styles.sectionLine, { backgroundColor: theme.hairline }]} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stamps}>
            {trustedContacts.map((c, i) => (
              <View key={c.id} style={styles.stampItem}>
                <Stamp
                  label={c.name}
                  sub={c.relation ?? "Trusted"}
                  color={c.color as string | undefined}
                  size={72}
                  rot={-6 + ((i * 7) % 12)}
                />
              </View>
            ))}
          </ScrollView>

          <View style={{ height: 140 }} />
        </ScrollView>
      </SafeAreaView>
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
    gap: 6,
    marginBottom: 10,
  },
  preset: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 2,
  },
  presetLabel: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 16,
    fontWeight: "500",
  },
  presetSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  actions: { gap: 8, marginBottom: 14 },
  actionRow: { flexDirection: "row", gap: 8 },
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
  stamps: {
    paddingHorizontal: 6,
    gap: 10,
    paddingBottom: 6,
  },
  stampItem: { paddingVertical: 4 },
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
    paddingVertical: 20,
    height: 180,
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
  logCard: { marginHorizontal: 16, marginTop: 4 },
  logTitle: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  logRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 6,
    alignItems: "flex-start",
  },
  logTime: {
    width: 28,
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    color: "rgba(255,255,255,0.7)",
    paddingTop: 2,
  },
  logDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  logDotPulse: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  logMessage: {
    flex: 1,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    color: "#fff",
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
});
