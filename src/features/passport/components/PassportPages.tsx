import React, { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Canvas, Fill, Shader } from "react-native-skia";
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Icon, PressableScale } from "@/atoms";
import { auraFonts as f } from "@/constants/aura";
import { useAuthStore } from "@/features/auth";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { useLocalization } from "@/localization";
import { usePassport, useHomeCountry } from "../hooks/usePassport";
import { buildMrz, iso3, passportNumber } from "../utils/mrz";
import { stampDate, type Seal, type Stamp } from "../utils/passport";
import { countryRegions } from "../utils/regions";
import { scatter } from "../utils/scatter";
import { lazyEffect, TiltSensor } from "./PassportCover";
import { HomeMap } from "./HomeMap";
import { INK } from "./PassportPaper";
import { PassportStamp, StateSeal } from "./PassportStamp";

export type PhotoState = "none" | "loading" | "loaded" | "error";

const PAD = 20;
const LABEL_SPACE = 34;
const FOOT_SPACE = 34;
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

// Holographic film over the photo: soft rainbow bands that slide with the phone's tilt.
const HOLO = lazyEffect(`
uniform float2 res;
uniform float tilt;

half4 main(float2 xy) {
  float2 uv = xy / res;
  float band = (uv.x * 0.7 + uv.y * 0.9) * 2.2 + tilt * 3.0;
  float3 hue = 0.5 + 0.5 * cos(6.2831 * (band + float3(0.0, 0.33, 0.67)));
  float ridge = 0.5 + 0.5 * sin((uv.x - uv.y) * 90.0);
  float a = (0.10 + 0.08 * ridge) * (0.6 + 0.4 * sin(band * 3.1416));
  return half4(half3(hue) * a, a);
}
`);

export function usePassportNumber() {
  const user = useAuthStore((state) => state.user);
  return passportNumber(user?.id ?? user?.name ?? "nomadsafe");
}

function Field({ label, value, big, mono }: { label: string; value: string; big?: boolean; mono?: boolean }) {
  return (
    <View style={styles.field}>
      <Text numberOfLines={1} style={styles.fieldLabel}>
        {label}
      </Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[big ? styles.bigValue : styles.fieldValue, mono && { fontFamily: MONO }]}>
        {value}
      </Text>
    </View>
  );
}

interface DataPageProps {
  width: number;
  height: number;
  turn: SharedValue<number>;
  photo: PhotoState;
  onPhoto: (state: PhotoState) => void;
}

/** The biodata page: photo with its ghost copy, passport fields, travel stats and the MRZ. */
export function DataPage({ width, height, turn, photo, onPhoto }: DataPageProps) {
  const [live, setLive] = useState(false);
  // The hologram follows the tilt only while this page lies open (page 1, at rest).
  useAnimatedReaction(
    () => Math.abs(turn.get() - 1) < 0.001,
    (open, previous) => {
      if (open !== previous) scheduleOnRN(setLive, open);
    },
  );
  const { t, locale } = useLocalization();
  const user = useAuthStore((state) => state.user);
  const passport = usePassport();
  const { code: home } = useHomeCountry();
  const number = usePassportNumber();
  const tilt = useSharedValue(0);
  const holo = useDerivedValue(() => ({ res: [PHOTO_W, PHOTO_H], tilt: tilt.get() }));
  const total = home ? countryRegions(home).length : 0;
  const first = passport.stamps.find((stamp) => !stamp.pending);
  const name = user?.name ?? t("common.fallbackTraveler");
  const avatar = user?.avatarUrl && photo !== "error" ? user.avatarUrl : null;
  const mrz = buildMrz({ name, home, number, issued: first?.date ?? null, countries: passport.countries, continents: passport.continents, daysAbroad: passport.daysAbroad });
  const mrzSize = Math.min(13, (width - PAD * 2) / (44 * 0.61));

  const stats = [
    { label: t("passport.statCountries"), value: String(passport.countries) },
    { label: t("passport.statContinents"), value: String(passport.continents) },
    { label: t("passport.statDaysAbroad"), value: String(passport.daysAbroad) },
    ...(home && total > 0 ? [{ label: t("passport.statStates"), value: t("passport.statesOf", { visited: passport.seals.length, total }) }] : []),
    { label: t("passport.statWorld"), value: `${Math.round((passport.countries / 195) * 100)}%` },
    ...(first ? [{ label: t("passport.statFirst"), value: stampDate(first.date, locale) }] : []),
  ];

  const portrait = (size: { width: number; height: number }) =>
    avatar ? (
      <Image source={{ uri: avatar }} style={size} contentFit="cover" cachePolicy="memory-disk" onLoad={() => onPhoto("loaded")} onError={() => onPhoto("error")} />
    ) : (
      <View style={[size, styles.initial]}>
        <Text style={[styles.initialText, { fontSize: size.height * 0.36 }]}>{name.charAt(0).toUpperCase()}</Text>
      </View>
    );

  return (
    <View style={[styles.pad, { height }]}>
      {live ? <TiltSensor target={tilt} turn={turn} /> : null}
      <View style={styles.headerRow}>
        <Text style={styles.pageLabel}>{t("passport.dataTitle")}</Text>
        <Text style={styles.code}>{`P  ${iso3(home)}`}</Text>
      </View>
      <View style={styles.identity}>
        <View style={styles.photo}>
          {portrait({ width: PHOTO_W, height: PHOTO_H })}
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Fill>
              <Shader source={HOLO()} uniforms={holo} />
            </Fill>
          </Canvas>
        </View>
        <View style={styles.fields}>
          <View style={styles.ghost}>{portrait({ width: 34, height: 43 })}</View>
          <Field label={t("passport.name")} value={name} />
          <Field label={t("passport.nationality")} value={home ? countryDisplayName(home, locale) : t("passport.homeUnset")} />
          <Field label={t("passport.number")} value={number} mono />
          {first ? <Field label={t("passport.issued")} value={stampDate(first.date, locale)} /> : null}
        </View>
      </View>
      <View style={styles.grid}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.cell}>
            <Field label={stat.label} value={stat.value} big />
          </View>
        ))}
      </View>
      <View style={styles.mrz}>
        {mrz.map((line) => (
          <Text key={line} numberOfLines={1} style={[styles.mrzLine, { fontSize: mrzSize }]}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

const PHOTO_W = 92;
const PHOTO_H = 116;

interface VisaPageProps {
  stamps: Stamp[];
  width: number;
  height: number;
  onOpen: (stamp: Stamp) => void;
  onAdd: () => void;
}

/** Visa pages: up to six stamps, set down by hand at seeded spots and angles. */
export function VisaPage({ stamps, width, height, onOpen, onAdd }: VisaPageProps) {
  const { t, locale } = useLocalization();
  const areaW = width - PAD * 2;
  const areaH = height - PAD - LABEL_SPACE - FOOT_SPACE;
  const area = { width: areaW, height: areaH };
  const stampW = Math.min((areaW / 2) * 1.04, (areaH / 3) * 1.15);
  const stampH = (stampW * 130) / 160;
  const spots = useMemo(
    () => scatter(stamps.map((stamp) => stamp.id), 2, 3, { width: areaW, height: areaH }, { width: stampW, height: stampH }),
    [stamps, areaW, areaH, stampW, stampH],
  );
  if (stamps.length === 0) {
    return (
      <View style={[styles.pad, styles.empty]}>
        <Text style={styles.pageLabel}>{t("passport.visaTitle")}</Text>
        <Text style={styles.emptyTitle}>{t("passport.emptyVisaTitle")}</Text>
        <Text style={styles.emptyBody}>{t("passport.emptyVisaBody")}</Text>
        <PressableScale onPress={onAdd} accessibilityRole="button" accessibilityLabel={t("passport.addPast")} style={styles.inkButton}>
          <Icon name="plus" size={15} color={INK.text} />
          <Text style={styles.inkButtonText}>{t("passport.addPast")}</Text>
        </PressableScale>
      </View>
    );
  }
  return (
    <View style={styles.pad}>
      <Text style={styles.pageLabel}>{t("passport.visaTitle")}</Text>
      <View style={[styles.area, area]}>
        {stamps.map((stamp, i) => (
          <View key={stamp.id} style={[styles.spot, { left: spots[i].x, top: spots[i].y, width: stampW, height: stampH, transform: [{ rotate: `${spots[i].rotate}deg` }] }]}>
            <PressableScale onPress={() => onOpen(stamp)} accessibilityRole="button" accessibilityLabel={`${countryDisplayName(stamp.country, locale)}, ${stampDate(stamp.date, locale)}`}>
              <PassportStamp
                seed={stamp.country}
                tiltSeed={stamp.id}
                title={countryDisplayName(stamp.country, locale)}
                top={stamp.place}
                bottom={stampDate(stamp.date, locale)}
                viaApp={stamp.viaApp}
                pending={stamp.pending}
                pendingLabel={t("passport.pending")}
                width={stampW}
                paper
                tilt={0}
              />
            </PressableScale>
          </View>
        ))}
      </View>
    </View>
  );
}

interface HomePageProps {
  home: string;
  seals: Seal[];
  map: boolean;
  width: number;
  height: number;
  onOpen: (seal: Seal) => void;
}

/** Home pages: the state map with the first seals, then seals scattered like postmarks. */
export function HomePage({ home, seals, map, width, height, onOpen }: HomePageProps) {
  const { t, locale } = useLocalization();
  const passport = usePassport();
  const regions = countryRegions(home);
  const names = new Map(regions.map((region) => [region.key, region.name]));
  const visited = new Set(passport.seals.map((seal) => seal.region));
  const areaW = width - PAD * 2;
  const areaH = height - PAD - LABEL_SPACE - FOOT_SPACE;
  const area = { width: areaW, height: areaH };
  const sealW = Math.min(areaW / 3, areaH / 3) * 1.02;
  const spots = useMemo(
    () => (map ? [] : scatter(seals.map((seal) => seal.region), 3, 3, { width: areaW, height: areaH }, { width: sealW, height: sealW })),
    [map, seals, areaW, areaH, sealW],
  );
  const seal = (item: Seal, size: number) => (
    <PressableScale onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={names.get(item.region) ?? item.region}>
      <StateSeal title={names.get(item.region) ?? item.region} bottom={stampDate(item.first, locale)} visits={item.visits} viaApp={item.viaApp} width={size} paper inkSeed={item.region} />
    </PressableScale>
  );
  return (
    <View style={styles.pad}>
      <Text style={styles.pageLabel}>{t("passport.homeTitle", { country: countryDisplayName(home, locale) })}</Text>
      {map ? (
        <>
          <View style={styles.map}>
            <HomeMap country={home} visited={visited} width={width - 44} height={230} paper />
          </View>
          <Text style={styles.statesLine}>{t("passport.statesVisited", { visited: visited.size, total: regions.length })}</Text>
          {seals.length === 0 ? <Text style={styles.emptyBody}>{t("passport.emptyHomeBody", { country: countryDisplayName(home, locale) })}</Text> : null}
          <View style={styles.sealGrid}>
            {seals.map((item) => (
              <View key={item.region}>{seal(item, (width - 44) / 2 - 8)}</View>
            ))}
          </View>
        </>
      ) : (
        <View style={[styles.area, area]}>
          {seals.map((item, i) => (
            <View key={item.region} style={[styles.spot, { left: spots[i].x, top: spots[i].y, transform: [{ rotate: `${spots[i].rotate}deg` }] }]}>
              {seal(item, sealW)}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { flex: 1, padding: PAD },
  headerRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  pageLabel: { fontFamily: f.semibold, fontSize: 11.5, letterSpacing: 1.6, textTransform: "uppercase", color: INK.muted, marginBottom: 14 },
  code: { fontFamily: MONO, fontSize: 12, color: INK.soft },
  identity: { flexDirection: "row", gap: 14, marginBottom: 18 },
  photo: { width: PHOTO_W, height: PHOTO_H, borderRadius: 6, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: INK.line },
  initial: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(29,34,48,0.07)" },
  initialText: { fontFamily: f.semibold, color: INK.soft },
  fields: { flex: 1, gap: 6 },
  ghost: { position: "absolute", right: 6, top: 4, opacity: 0.2, borderRadius: 3, overflow: "hidden" },
  field: { gap: 1 },
  fieldLabel: { fontFamily: f.medium, fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: INK.muted },
  fieldValue: { fontFamily: f.semibold, fontSize: 15, color: INK.text, paddingRight: 40 },
  bigValue: { fontFamily: f.semibold, fontSize: 21, letterSpacing: -0.4, color: INK.text },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
  cell: { width: "50%", paddingRight: 8 },
  mrz: { position: "absolute", left: PAD, right: PAD, bottom: 34, gap: 2 },
  mrzLine: { fontFamily: MONO, color: INK.text, letterSpacing: 0 },
  area: { position: "relative" },
  spot: { position: "absolute" },
  empty: { justifyContent: "center", alignItems: "flex-start", gap: 10 },
  emptyTitle: { fontFamily: f.semibold, fontSize: 24, letterSpacing: -0.6, color: INK.text },
  emptyBody: { fontFamily: f.regular, fontSize: 15, lineHeight: 21, color: INK.soft, marginBottom: 8 },
  inkButton: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: INK.soft },
  inkButtonText: { fontFamily: f.semibold, fontSize: 15, color: INK.text },
  map: { alignItems: "center", marginBottom: 6 },
  statesLine: { fontFamily: f.medium, fontSize: 15, color: INK.text, marginBottom: 10 },
  sealGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
