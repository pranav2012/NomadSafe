import React, { useEffect, useMemo } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { PrivateView } from "@/modules/analytics";
import { MapView, Marker } from "@/modules/location";
import { AuraButton, AuraCard, Icon, LiveDot, useAura, useTabBarInset } from "@/atoms";
import { auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { useAppLocked } from "@/features/auth";
import { quietMapStyle } from "@/features/home/components/aura/mapStyles";
import { useLocalization } from "@/localization";

const ALERT = auraStatusAccent.alert;
const [GLOW_A, GLOW_B] = auraStatusColors.alert;

interface EmergencyTakeoverProps {
  emergencyNumber: string;
  statusLines: { text: string; muted?: boolean }[];
  isOffline: boolean;
  location: { latitude: number; longitude: number } | null;
  sharingLive: boolean;
  fixAge: string | null;
  alertBusy: boolean;
  /** Label for the button that (re)starts live sharing; null hides it. */
  sharingActionLabel: string | null;
  onCall: () => void;
  onAlertAgain: () => void;
  onSharingAction: () => void;
  onCancel: () => void;
}

/** Full-screen state while an SOS is active: what was sent, where you are, and how to get help. */
export function EmergencyTakeover({
  emergencyNumber,
  statusLines,
  isOffline,
  location,
  sharingLive,
  fixAge,
  alertBusy,
  sharingActionLabel,
  onCall,
  onAlertAgain,
  onSharingAction,
  onCancel,
}: EmergencyTakeoverProps) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const mapStyle = useMemo(() => quietMapStyle(isDark), [isDark]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <LinearGradient pointerEvents="none" colors={[`${GLOW_A}55`, `${GLOW_B}1F`, `${c.bg}00`]} style={styles.glow} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 28, paddingBottom: tabBarInset + 24 }]}
      >
        <Pulse />
        <Text style={[styles.eyebrow, { fontFamily: f.semibold }]}>{t("sos.codeRed")}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
          {t("sos.sosActive")}
        </Text>
        <View accessibilityLiveRegion="polite" style={styles.lines}>
          {statusLines.map((line) => (
            <Text
              key={line.text}
              style={[line.muted ? styles.muted : styles.status, { color: line.muted ? c.textMuted : c.textSoft, fontFamily: f.regular }]}
            >
              {line.text}
            </Text>
          ))}
        </View>

        {isOffline ? (
          <AuraCard tone={ALERT} style={styles.offline}>
            <View style={styles.offlineRow} accessibilityRole="alert">
              <Icon name="wifi" size={16} color={ALERT} />
              <Text style={[styles.offlineText, { color: c.text, fontFamily: f.medium }]}>{t("sos.offlineCircle")}</Text>
            </View>
          </AuraCard>
        ) : null}

        <View style={[styles.mapCard, { borderColor: c.hairline, backgroundColor: c.surface }]}>
          {location ? (
            <PrivateView style={StyleSheet.absoluteFill}>
              <MapView
                style={StyleSheet.absoluteFill}
                initialRegion={{ ...location, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                customMapStyle={mapStyle}
                userInterfaceStyle={isDark ? "dark" : "light"}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
              >
                <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={t("sos.yourLocation")}>
                  <View style={[styles.halo, { backgroundColor: `${ALERT}33` }]}>
                    <View style={[styles.dot, { backgroundColor: ALERT }]} />
                  </View>
                </Marker>
              </MapView>
            </PrivateView>
          ) : (
            <View style={styles.mapFallback}>
              <Icon name="mapPin" size={26} color={c.textMuted} />
              <Text style={[styles.muted, { color: c.textMuted, fontFamily: f.medium }]}>{t("sos.locating")}</Text>
            </View>
          )}
          {location && sharingLive ? (
            <View style={[styles.liveChip, { backgroundColor: c.card, borderColor: c.hairline }]}>
              <LiveDot color={ALERT} size={7} />
              <Text style={[styles.liveText, { color: c.text, fontFamily: f.semibold }]}>{t("sos.broadcasting")}</Text>
            </View>
          ) : null}
        </View>
        {fixAge ? (
          <Text style={[styles.fixAge, { color: c.textMuted, fontFamily: f.medium }]} accessibilityLiveRegion="polite">
            {t("sos.locationFixedAgo", { age: fixAge })}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <AuraButton label={t("sos.callEmergency", { number: emergencyNumber })} icon="phone" variant="danger" onPress={onCall} />
          <AuraButton label={t("sos.alertAgain")} icon="bell" variant="secondary" loading={alertBusy} onPress={onAlertAgain} />
          {sharingActionLabel ? <AuraButton label={sharingActionLabel} icon="mapPin" variant="secondary" onPress={onSharingAction} /> : null}
          <AuraButton label={t("sos.cancelSos")} variant="ghost" onPress={onCancel} />
          <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("sos.cancelHint")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Pulse() {
  const ripple = useSharedValue(0);
  useEffect(() => {
    ripple.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
  }, [ripple]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - ripple.get()),
    transform: [{ scale: 1 + ripple.get() * 0.7 }],
  }));
  return (
    <View style={styles.pulse}>
      <Animated.View style={[styles.pulseRing, ringStyle]} />
      <View style={styles.pulseCore}>
        <Icon name="shield" size={40} color="#FFFFFF" strokeWidth={1.6} />
      </View>
    </View>
  );
}

interface SosCountdownOverlayProps {
  seconds: number | null;
  /** Who will be alerted when the countdown ends. */
  body: string;
  onCancel: () => void;
  onSendNow: () => void;
}

/** The cancel window between the SOS hold (or widget tap) and contacts being alerted. */
export function SosCountdownOverlay({ seconds, body, onCancel, onSendNow }: SosCountdownOverlayProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  // While PIN-locked the Safety screen behind must not show through.
  const locked = useAppLocked();
  return (
    <Modal visible={seconds !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={[styles.scrim, locked && { backgroundColor: c.bg }]}>
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: `${ALERT}66` }]}>
          <LinearGradient pointerEvents="none" colors={[`${GLOW_A}40`, `${c.card}00`]} style={StyleSheet.absoluteFill} />
          <Text style={[styles.eyebrow, { fontFamily: f.semibold }]}>{t("sos.codeRed")}</Text>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            accessibilityLabel={t("sos.countdownTitle", { seconds: seconds ?? 0 })}
            style={[styles.count, { fontFamily: f.semibold }]}
          >
            {seconds ?? 0}
          </Text>
          <Text style={[styles.status, styles.center, { color: c.textSoft, fontFamily: f.regular }]}>
            {body}
          </Text>
          <View style={styles.countButtons}>
            <AuraButton label={t("sos.countdownCancel")} onPress={onCancel} />
            <AuraButton label={t("sos.countdownSendNow")} variant="danger" onPress={onSendNow} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 440 },
  scroll: { paddingHorizontal: 20 },
  pulse: { width: 96, height: 96, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  pulseRing: { position: "absolute", width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: ALERT },
  pulseCore: { width: 80, height: 80, borderRadius: 40, backgroundColor: ALERT, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: ALERT, fontSize: 13, letterSpacing: 0.4 },
  title: { fontSize: 36, letterSpacing: -1.2, marginTop: 4 },
  lines: { gap: 6, marginTop: 10 },
  status: { fontSize: 15, lineHeight: 21 },
  muted: { fontSize: 13.5, lineHeight: 19 },
  center: { textAlign: "center" },
  offline: { marginTop: 16, padding: 14 },
  offlineRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  offlineText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  mapCard: { height: 180, marginTop: 20, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  mapFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  halo: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: "#FFFFFF" },
  liveChip: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  liveText: { fontSize: 12.5 },
  fixAge: { fontSize: 12.5, marginTop: 8, paddingHorizontal: 4 },
  actions: { gap: 10, marginTop: 22 },
  hint: { fontSize: 12.5, textAlign: "center" },
  scrim: { flex: 1, backgroundColor: "rgba(4,5,9,0.72)", justifyContent: "center", padding: 20 },
  sheet: { borderRadius: 30, borderWidth: 1, padding: 24, alignItems: "center", overflow: "hidden" },
  count: { color: ALERT, fontSize: 88, lineHeight: 96, letterSpacing: -3, fontVariant: ["tabular-nums"], marginTop: 6 },
  countButtons: { alignSelf: "stretch", gap: 10, marginTop: 22 },
});
