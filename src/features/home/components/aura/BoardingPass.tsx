import React, { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import {
  Canvas,
  DashPathEffect,
  Fill,
  Group,
  Line,
  LinearGradient,
  RoundedRect,
  Shader,
  Skia,
  rect,
  rrect,
  vec,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Icon, LiveDot, PressableScale, RollingNumber, springs } from "@/atoms";
import type { EmergencyContact } from "@/features/onboarding/services/emergencyContactsStorage";
import { lightImpact } from "@/utils/haptics";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import type { HomeData } from "@/features/home/types";
import { SAFETY_KIND_META } from "./safety/kinds";
import { useLocalization } from "@/localization";
import { formatDistance } from "@/features/home/utils/format";
import type { SafetyPlace } from "@/features/home/hooks/useTripSafety";
import { auraFonts as f, type AuraPalette } from "@/constants/aura";

// Holographic foil: rainbow bands and fine diagonal ridges whose phase follows the card's tilt,
// plus a soft specular streak that slides across as it turns. Static when the phone is still.
const FOIL = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float2 tilt;
uniform float strength;

half4 main(float2 xy) {
  float2 uv = xy / res;
  float band = dot(uv, normalize(float2(0.8, 0.6))) * 2.6 + tilt.x * 1.8 + tilt.y * 1.2;
  float3 hue = 0.5 + 0.5 * cos(6.2831 * (band + float3(0.0, 0.33, 0.67)));
  float ridges = 0.5 + 0.5 * sin((uv.x + uv.y * 0.55) * 110.0 + tilt.x * 24.0);
  float streak = exp(-pow((uv.x - 0.5 - tilt.x * 0.9 + (uv.y - 0.5) * 0.4) * 2.4, 2.0));
  float a = (0.05 + 0.06 * ridges) * (0.35 + 0.9 * streak) * strength;
  return half4(half3(hue) * a + half3(streak * 0.05 * strength), a + streak * 0.05 * strength);
}
`)!;

// The safety-state aura, living inside the card: three soft colour pools drifting slowly.
const AURA = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float time;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;
uniform float strength;

float pool(float2 uv, float2 c, float r, float2 aspect) {
  float d = length((uv - c) * aspect) / r;
  return exp(-d * d);
}

half4 main(float2 xy) {
  float2 uv = xy / res;
  float2 aspect = float2(res.x / res.y, 1.0);
  float w1 = pool(uv, float2(0.12 + 0.1 * sin(time * 0.35), 0.2 + 0.2 * cos(time * 0.28)), 0.9, aspect);
  float w2 = pool(uv, float2(0.88 + 0.08 * cos(time * 0.31), 0.35 + 0.25 * sin(time * 0.4)), 0.8, aspect);
  float w3 = pool(uv, float2(0.5 + 0.3 * sin(time * 0.22 + 1.7), 1.0 + 0.1 * cos(time * 0.26)), 0.85, aspect);
  float total = w1 + w2 + w3;
  float3 col = (c1 * w1 + c2 * w2 + c3 * w3) / max(total, 0.001);
  float a = clamp(total, 0.0, 1.0) * strength;
  return half4(half3(col) * a, a);
}
`)!;

const HEIGHT = 200;
const RADIUS = 24;
const MAX_TILT = 0.45;
const STUB_Y = 130;
// The aura pools drift slowly, so ~15 fps is indistinguishable from full rate; tilt samples at ~30 Hz.
const AURA_TICK_MS = 66;
const SENSOR_INTERVAL_MS = 33;
// Gravity for a phone held at a normal reading angle, so the card rests flat before the first sample.
const REST_GRAVITY = { x: 0, y: -0.6, z: -0.8 };

function code(name: string | undefined) {
  return (name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "—";
}

function toRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

export interface EmergencyInfo {
  hospital: { place: SafetyPlace; km: number } | null;
  police: { place: SafetyPlace; km: number } | null;
  stayName: string | null;
  contacts: EmergencyContact[];
  loading: boolean;
}

interface BoardingPassProps {
  data: HomeData;
  palette: AuraPalette;
  accent: string;
  gradient: [string, string, string];
  isDark: boolean;
  emergency: EmergencyInfo;
  /** True while the page scrolls; the aura and tilt hold still so scroll frames aren't dropped. */
  scrolling?: SharedValue<boolean>;
}

/**
 * Trip as a Wallet-style pass: the safety-state aura glows inside it under a holographic foil
 * that shifts as the phone tilts (or as you drag it). Tap to flip it to an emergency card.
 */
export function BoardingPass({ data, palette: c, accent, gradient, isDark, emergency, scrolling }: BoardingPassProps) {
  const { width: windowWidth } = useWindowDimensions();
  const width = windowWidth - 40;
  const [isBack, setIsBack] = useState(false);
  const { t } = useLocalization();
  const reduceMotion = useReducedMotion();
  const animating = useAnimationsActive() && !reduceMotion;
  const auraTime = useSharedValue(0);
  const auraClock = useSharedValue(0);

  const auraTicker = useFrameCallback((info) => {
    if (scrolling?.get()) return;
    auraClock.set(auraClock.get() + (info.timeSincePreviousFrame ?? 16));
    if (auraClock.get() - auraTime.get() * 1000 >= AURA_TICK_MS) auraTime.set(auraClock.get() / 1000);
  }, false);
  useEffect(() => {
    auraTicker.setActive(animating);
  }, [animating, auraTicker]);

  const gravity = useSharedValue(REST_GRAVITY);
  const drag = useSharedValue({ x: 0, y: 0 });
  const dragging = useSharedValue(0);
  const flip = useSharedValue(0);

  const tilt = useDerivedValue(() => {
    const g = gravity.get();
    const len = Math.hypot(g.x, g.y, g.z) || 1;
    const sx = Math.max(-MAX_TILT, Math.min(MAX_TILT, (g.x / len) * 0.9));
    const sy = Math.max(-MAX_TILT, Math.min(MAX_TILT, (g.y / len + 0.6) * 0.9));
    const d = drag.get();
    const k = dragging.get();
    return { x: sx * (1 - k) + d.x * k, y: sy * (1 - k) + d.y * k };
  });

  const setSide = (back: boolean) => {
    flip.set(withSpring(back ? 1 : 0, { damping: 16, stiffness: 120, mass: 0.9 }));
    lightImpact();
    setIsBack(back);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onBegin(() => {
      dragging.set(withSpring(1, springs.press));
    })
    .onChange((event) => {
      drag.set({
        x: Math.max(-MAX_TILT, Math.min(MAX_TILT, event.translationX / 260)),
        y: Math.max(-MAX_TILT, Math.min(MAX_TILT, -event.translationY / 160)),
      });
    })
    .onFinalize(() => {
      dragging.set(withSpring(0, springs.bouncy));
    });
  const tap = Gesture.Tap()
    .enabled(!isBack)
    .onEnd(() => {
      scheduleOnRN(setSide, true);
    });

  const cardStyle = useAnimatedStyle(() => {
    const t = tilt.get();
    return {
      transform: [{ perspective: 1000 }, { rotateX: `${-t.y * 14}deg` }, { rotateY: `${t.x * 14 + flip.get() * 180}deg` }],
    };
  });
  const frontStyle = useAnimatedStyle(() => ({ opacity: flip.get() < 0.5 ? 1 : 0 }));
  const backStyle = useAnimatedStyle(() => ({ opacity: flip.get() >= 0.5 ? 1 : 0 }));

  const auraColors = gradient.map(toRgb);
  const foilUniforms = useDerivedValue(() => ({ res: [width, HEIGHT], tilt: [tilt.get().x, tilt.get().y], strength: isDark ? 1 : 0.7 }));
  const auraUniforms = useDerivedValue(() => ({
    res: [width, HEIGHT],
    time: auraTime.get(),
    c1: auraColors[0],
    c2: auraColors[1],
    c3: auraColors[2],
    strength: isDark ? 0.42 : 0.3,
  }));

  const many = data.destinations.length > 1;
  const from = data.destinations[0];
  const to = data.destinations[data.destinations.length - 1];
  const upcoming = data.countdown !== null;
  const bigNumber = String(upcoming ? data.countdown : data.day);
  const cardColors = isDark ? ["#171A24", "#0F1219"] : ["#FFFFFF", "#ECEFF5"];
  const cardShape = rrect(rect(0, 0, width, HEIGHT), RADIUS, RADIUS);

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View style={[styles.card, { width, height: HEIGHT }, cardStyle]}>
        {animating ? <GravitySensor target={gravity} scrolling={scrolling} /> : null}
        <Animated.View style={[StyleSheet.absoluteFill, frontStyle]} accessible accessibilityRole="button" accessibilityLabel={data.tripName}>
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Group clip={cardShape}>
              <Fill>
                <LinearGradient start={vec(0, 0)} end={vec(width, HEIGHT)} colors={cardColors} />
              </Fill>
              <Fill>
                <Shader source={AURA} uniforms={auraUniforms} />
              </Fill>
              <Fill>
                <Shader source={FOIL} uniforms={foilUniforms} />
              </Fill>
            </Group>
            <Line p1={vec(20, STUB_Y)} p2={vec(width - 20, STUB_Y)} color={c.hairline} strokeWidth={1.5}>
              <DashPathEffect intervals={[4, 6]} />
            </Line>
            <RoundedRect x={0.5} y={0.5} width={width - 1} height={HEIGHT - 1} r={RADIUS} style="stroke" strokeWidth={1} color={c.highlight} />
          </Canvas>
          <View style={[styles.notch, { left: -11, top: STUB_Y - 11, backgroundColor: c.bg }]} />
          <View style={[styles.notch, { right: -11, top: STUB_Y - 11, backgroundColor: c.bg }]} />

          <View style={styles.front}>
            <View style={styles.headerRow}>
              <Text numberOfLines={1} style={[styles.tripName, { color: c.textSoft }]}>
                {data.tripName}
              </Text>
              <View style={styles.status}>
                <LiveDot color={accent} active={data.isSharing} size={6} />
                <Text style={[styles.statusText, { color: c.textSoft }]}>{data.sharingLabel}</Text>
              </View>
            </View>
            <View style={styles.routeRow}>
              <View>
                <Text style={[styles.code, { color: c.text }]}>{code(from)}</Text>
                <Text numberOfLines={1} style={[styles.city, { color: c.textMuted }]}>
                  {from}
                </Text>
              </View>
              {many ? (
                <>
                  <View style={styles.flightLine}>
                    <View style={[styles.flightDash, { borderColor: c.textMuted }]} />
                    <Icon name="send" size={16} color={accent} />
                    <View style={[styles.flightDash, { borderColor: c.textMuted }]} />
                  </View>
                  <View style={styles.alignEnd}>
                    <Text style={[styles.code, { color: c.text }]}>{code(to)}</Text>
                    <Text numberOfLines={1} style={[styles.city, { color: c.textMuted }]}>
                      {to}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>
            <View style={styles.stubRow}>
              <View style={styles.dayBlock}>
                <RollingNumber value={bigNumber} lineHeight={50} style={[styles.bigNumber, { color: c.text }]} />
                {!upcoming ? <Text style={[styles.of, { color: c.textMuted }]}>/{data.totalDays}</Text> : null}
              </View>
              <View style={styles.alignEnd}>
                <Text style={[styles.meta, { color: c.text }]}>{upcoming ? data.dayLabel : data.daysLeftLabel}</Text>
                <Text style={[styles.metaSub, { color: c.textMuted }]}>{data.travellersLabel}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          pointerEvents={isBack ? "auto" : "none"}
          style={[StyleSheet.absoluteFill, styles.back, { backgroundColor: isDark ? "#151924" : "#FFFFFF", borderColor: c.highlight }, backStyle]}
        >
          <View style={styles.backHeader}>
            <Text style={[styles.backTitle, { color: c.text }]}>{t("home.emergencyTitle")}</Text>
            <PressableScale
              onPress={() => setSide(false)}
              accessibilityRole="button"
              accessibilityLabel={t("home.showPass")}
              style={[styles.flipBack, { backgroundColor: c.surfaceStrong }]}
            >
              <Icon name="swap" size={14} color={c.text} />
            </PressableScale>
          </View>
          <EmergencyRow kind="hospital" entry={emergency.hospital} loading={emergency.loading} palette={c} />
          <EmergencyRow kind="police" entry={emergency.police} loading={emergency.loading} palette={c} />
          {emergency.stayName ? (
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: c.inverse }]}>
                <Icon name="building" size={12} color={c.onInverse} />
              </View>
              <Text numberOfLines={1} style={[styles.rowName, { color: c.text }]}>
                {emergency.stayName}
              </Text>
              <Text style={[styles.rowMeta, { color: c.textMuted }]}>{t("home.yourStay")}</Text>
            </View>
          ) : null}
          <View style={styles.contactsRow}>
            {emergency.contacts.slice(0, 3).map((contact) => (
              <PressableScale
                key={contact.id}
                disabled={!contact.phone}
                onPress={() => {
                  if (contact.phone) void Linking.openURL(`tel:${contact.phone}`);
                }}
                style={[styles.contactChip, { backgroundColor: c.surfaceStrong, opacity: contact.phone ? 1 : 0.5 }]}
              >
                <Icon name="phone" size={12} color={c.text} />
                <Text numberOfLines={1} style={[styles.contactName, { color: c.text }]}>
                  {contact.name.split(" ")[0]}
                </Text>
              </PressableScale>
            ))}
            {emergency.contacts.length === 0 ? (
              <Text style={[styles.rowMeta, { color: c.textMuted }]}>{t("home.addTrustedContacts")}</Text>
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function EmergencyRow({
  kind,
  entry,
  loading,
  palette: c,
}: {
  kind: "hospital" | "police";
  entry: { place: SafetyPlace; km: number } | null;
  loading: boolean;
  palette: AuraPalette;
}) {
  const meta = SAFETY_KIND_META[kind];
  const { t, locale } = useLocalization();
  const finding = kind === "hospital" ? t("home.findingHospital") : t("home.findingPolice");
  const none = kind === "hospital" ? t("home.noHospital") : t("home.noPolice");
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: meta.color }]}>
        <Icon name={meta.icon} size={12} color="#FFFFFF" strokeWidth={2.4} />
      </View>
      <Text numberOfLines={1} style={[styles.rowName, { color: c.text }]}>
        {entry ? entry.place.name : loading ? finding : none}
      </Text>
      {entry ? <Text style={[styles.rowMeta, { color: c.textMuted }]}>{formatDistance(entry.km, locale)}</Text> : null}
      {entry?.place.phone ? (
        <PressableScale
          onPress={() => void Linking.openURL(`tel:${entry.place.phone}`)}
          accessibilityRole="button"
          accessibilityLabel={t("home.callPlace", { name: entry.place.name })}
          style={[styles.call, { backgroundColor: c.inverse }]}
        >
          <Icon name="phone" size={12} color={c.onInverse} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: "center", borderRadius: RADIUS },
  notch: { position: "absolute", width: 22, height: 22, borderRadius: 11 },
  front: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  tripName: { fontFamily: f.medium, fontSize: 13, flexShrink: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontFamily: f.medium, fontSize: 12 },
  routeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 10 },
  code: { fontFamily: f.semibold, fontSize: 34, letterSpacing: 1 },
  city: { fontFamily: f.regular, fontSize: 12.5, maxWidth: 120 },
  flightLine: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 },
  flightDash: { flex: 1, borderTopWidth: 1, borderStyle: "dashed" },
  alignEnd: { alignItems: "flex-end" },
  stubRow: { position: "absolute", left: 20, right: 20, bottom: 10, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  dayBlock: { flexDirection: "row", alignItems: "flex-end" },
  bigNumber: { fontFamily: f.semibold, fontSize: 46, letterSpacing: -1.5 },
  of: { fontFamily: f.medium, fontSize: 16, marginBottom: 9, marginStart: 2 },
  meta: { fontFamily: f.semibold, fontSize: 14 },
  metaSub: { fontFamily: f.regular, fontSize: 12.5, marginTop: 2 },
  back: {
    borderRadius: RADIUS,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 8,
    transform: [{ rotateY: "180deg" }],
  },
  backHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backTitle: { fontFamily: f.semibold, fontSize: 15 },
  flipBack: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 28 },
  rowIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowName: { fontFamily: f.medium, fontSize: 13.5, flex: 1 },
  rowMeta: { fontFamily: f.regular, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  call: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  contactsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  contactChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14, maxWidth: 110 },
  contactName: { fontFamily: f.semibold, fontSize: 12.5 },
});

/** Mounted only while the pass is visible, so the gravity sensor is released otherwise. */
function GravitySensor({ target, scrolling }: { target: SharedValue<{ x: number; y: number; z: number }>; scrolling?: SharedValue<boolean> }) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: SENSOR_INTERVAL_MS });
  useAnimatedReaction(
    () => sensor.sensor.get(),
    (g) => {
      if (scrolling?.get()) return;
      target.set({ x: g.x, y: g.y, z: g.z });
    },
  );
  return null;
}
