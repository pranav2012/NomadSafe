import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";
import { AuraButton, AuraSheet, Icon, PressableScale, useAura } from "@/atoms";
import { auraDark, auraFonts as f } from "@/constants/aura";
import { useAuthStore } from "@/features/auth";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { getTripStatus } from "@/features/trips/utils/dates";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { AddPastTravelSheet } from "../components/AddPastTravelSheet";
import { PassportBook } from "../components/PassportBook";
import { HomeMap } from "../components/HomeMap";
import { PassportStamp, StateSeal } from "../components/PassportStamp";
import { useHomeCountry, usePassport } from "../hooks/usePassport";
import { usePassportStore } from "../store/passportStore";
import { stampDate, type Seal, type Stamp } from "../utils/passport";
import { countryRegions } from "../utils/regions";

const c = auraDark;
const STAMPS_PER_PAGE = 6;
const SEALS_FIRST_PAGE = 4;
const SEALS_PER_PAGE = 9;

type Page = { kind: "cover" } | { kind: "data" } | { kind: "visa"; stamps: Stamp[] } | { kind: "home"; seals: Seal[]; map: boolean };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The passport: cover, data page, visa pages with stamps and home pages with state seals. */
export default function PassportScreen() {
  const { source } = useLocalSearchParams<{ source?: "trips" | "replay" }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useLocalization();
  const passport = usePassport();
  const { code: home } = useHomeCountry();
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<Stamp | null>(null);
  const [sealDetail, setSealDetail] = useState<Seal | null>(null);
  const [page, setPage] = useState(0);
  const [pagerHeight, setPagerHeight] = useState(0);

  React.useEffect(() => {
    track("passport_opened", {
      source: source ?? "trips",
      stamps: passport.stamps.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = useMemo<Page[]>(() => {
    const visa = chunk(passport.stamps, STAMPS_PER_PAGE);
    const homePages: Page[] = home
      ? [
          {
            kind: "home",
            seals: passport.seals.slice(0, SEALS_FIRST_PAGE),
            map: countryRegions(home).length > 0,
          },
          ...chunk(passport.seals.slice(SEALS_FIRST_PAGE), SEALS_PER_PAGE).map((seals): Page => ({ kind: "home", seals, map: false })),
        ]
      : [];
    return [{ kind: "cover" }, { kind: "data" }, ...(visa.length > 0 ? visa : [[]]).map((stamps): Page => ({ kind: "visa", stamps })), ...homePages];
  }, [home, passport.seals, passport.stamps]);

  const pageHeight = Math.min(pagerHeight - 16, 660);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>{t("passport.title")}</Text>
        <PressableScale onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel={t("passport.addPast")} style={styles.round}>
          <Icon name="plus" size={16} color={c.text} />
        </PressableScale>
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("trip.close")} style={styles.round}>
          <Icon name="x" size={16} color={c.text} />
        </PressableScale>
      </View>

      <View style={styles.flex} onLayout={(event) => setPagerHeight(event.nativeEvent.layout.height)}>
        {pagerHeight > 0 ? (
          <View style={styles.bookWrap}>
            <PassportBook
              width={width - 40}
              height={pageHeight}
              onPageChange={setPage}
              pages={pages.map((item, i) => (
                <PageFace key={`${item.kind}-${i}`}>
                  {item.kind === "cover" ? <Cover /> : null}
                  {item.kind === "data" ? <DataPage /> : null}
                  {item.kind === "visa" ? <VisaPage stamps={item.stamps} width={width - 40} onOpen={setDetail} onAdd={() => setAdding(true)} /> : null}
                  {item.kind === "home" && home ? <HomePage home={home} seals={item.seals} map={item.map} width={width - 40} onOpen={setSealDetail} /> : null}
                </PageFace>
              ))}
            />
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.dots}>
          {pages.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
        <AuraButton label={t("passport.addPast")} icon="plus" variant="secondary" onPress={() => setAdding(true)} />
      </View>

      <AddPastTravelSheet visible={adding} onClose={() => setAdding(false)} />
      <StampSheet stamp={detail} onClose={() => setDetail(null)} />
      {home ? <SealSheet home={home} seal={sealDetail} onClose={() => setSealDetail(null)} /> : null}
    </View>
  );
}

/** Paper for one passport page: the card's dark gradient with a soft aurora corner. */
function PageFace({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.flex}>
      <LinearGradient colors={["#1A1E29", c.card, "#0F1219"]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={["rgba(91,108,255,0.22)", "rgba(91,108,255,0)"]} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.5 }} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}

function Mark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <SvgGradient id="markAurora" x1="96" y1="420" x2="416" y2="92" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#22C7B8" />
          <Stop offset="0.55" stopColor="#5B6CFF" />
          <Stop offset="1" stopColor="#9B7BFF" />
        </SvgGradient>
      </Defs>
      <Path d="M184 340 V172 L328 340 V172" fill="none" stroke="url(#markAurora)" strokeWidth={46} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M92 380 C170 430 342 430 420 380" fill="none" stroke={c.text} strokeWidth={6} strokeLinecap="round" strokeDasharray="2 14" opacity={0.55} />
    </Svg>
  );
}

function Cover() {
  const { t, locale } = useLocalization();
  const user = useAuthStore((state) => state.user);
  const { code: home } = useHomeCountry();
  return (
    <View style={styles.cover}>
      <LinearGradient colors={["#171B3A", "#121633", "#0D1024"]} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={["rgba(34,199,184,0.18)", "rgba(155,123,255,0.22)", "rgba(0,0,0,0)"]}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <Mark size={150} />
      <Text style={styles.coverTitle}>{t("passport.title")}</Text>
      {user?.name ? <Text style={styles.coverName}>{user.name}</Text> : null}
      {home ? <Text style={styles.coverHome}>{countryDisplayName(home, locale)}</Text> : null}
      <Text style={styles.coverBrand}>NomadSafe</Text>
    </View>
  );
}

function DataPage() {
  const { t, locale } = useLocalization();
  const user = useAuthStore((state) => state.user);
  const passport = usePassport();
  const { code: home } = useHomeCountry();
  const total = home ? countryRegions(home).length : 0;
  const first = passport.stamps.find((stamp) => !stamp.pending);
  const fields = [
    { label: t("passport.statCountries"), value: String(passport.countries) },
    { label: t("passport.statContinents"), value: String(passport.continents) },
    { label: t("passport.statDaysAbroad"), value: String(passport.daysAbroad) },
    ...(home && total > 0
      ? [
          {
            label: t("passport.statStates"),
            value: t("passport.statesOf", {
              visited: passport.seals.length,
              total,
            }),
          },
        ]
      : []),
    {
      label: t("passport.statWorld"),
      value: `${Math.round((passport.countries / 195) * 100)}%`,
    },
    ...(first
      ? [
          {
            label: t("passport.statFirst"),
            value: stampDate(first.date, locale),
          },
        ]
      : []),
  ];
  return (
    <View style={styles.pad}>
      <Text style={styles.pageLabel}>{t("passport.dataTitle")}</Text>
      <View style={styles.identity}>
        <View style={styles.photo}>
          <Text style={styles.photoText}>{(user?.name ?? "N").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.fieldLabel}>{t("passport.name")}</Text>
          <Text numberOfLines={1} style={styles.fieldValue}>
            {user?.name ?? t("common.fallbackTraveler")}
          </Text>
          <Text style={[styles.fieldLabel, styles.gapTop]}>{t("passport.home")}</Text>
          <Text numberOfLines={1} style={styles.fieldValue}>
            {home ? countryDisplayName(home, locale) : t("passport.homeUnset")}
          </Text>
        </View>
      </View>
      <View style={styles.grid}>
        {fields.map((field) => (
          <View key={field.label} style={styles.cell}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <Text numberOfLines={1} style={styles.bigValue}>
              {field.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function VisaPage({ stamps, width, onOpen, onAdd }: { stamps: Stamp[]; width: number; onOpen: (stamp: Stamp) => void; onAdd: () => void }) {
  const { t, locale } = useLocalization();
  const stampWidth = (width - 44 - 14) / 2;
  if (stamps.length === 0) {
    return (
      <View style={[styles.pad, styles.empty]}>
        <Text style={styles.pageLabel}>{t("passport.visaTitle")}</Text>
        <Text style={styles.emptyTitle}>{t("passport.emptyVisaTitle")}</Text>
        <Text style={styles.emptyBody}>{t("passport.emptyVisaBody")}</Text>
        <AuraButton label={t("passport.addPast")} icon="plus" variant="secondary" size="md" onPress={onAdd} />
      </View>
    );
  }
  return (
    <View style={styles.pad}>
      <Text style={styles.pageLabel}>{t("passport.visaTitle")}</Text>
      <View style={styles.stampGrid}>
        {stamps.map((stamp, i) => (
          <PressableScale
            key={stamp.id}
            onPress={() => onOpen(stamp)}
            accessibilityRole="button"
            accessibilityLabel={`${countryDisplayName(stamp.country, locale)}, ${stampDate(stamp.date, locale)}`}
            style={{ width: stampWidth, marginTop: i % 2 === 1 ? 14 : 0 }}
          >
            <PassportStamp
              seed={stamp.country}
              tiltSeed={stamp.id}
              title={countryDisplayName(stamp.country, locale)}
              top={stamp.place}
              bottom={stampDate(stamp.date, locale)}
              viaApp={stamp.viaApp}
              pending={stamp.pending}
              pendingLabel={t("passport.pending")}
              width={stampWidth}
            />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

function HomePage({ home, seals, map, width, onOpen }: { home: string; seals: Seal[]; map: boolean; width: number; onOpen: (seal: Seal) => void }) {
  const { t, locale } = useLocalization();
  const passport = usePassport();
  const regions = countryRegions(home);
  const names = new Map(regions.map((region) => [region.key, region.name]));
  const visited = new Set(passport.seals.map((seal) => seal.region));
  const sealWidth = map ? (width - 44) / 2 - 8 : (width - 44) / 3 - 6;
  return (
    <View style={styles.pad}>
      <Text style={styles.pageLabel}>{t("passport.homeTitle", { country: countryDisplayName(home, locale) })}</Text>
      {map ? (
        <>
          <View style={styles.map}>
            <HomeMap country={home} visited={visited} width={width - 44} height={map ? 230 : 0} />
          </View>
          <Text style={styles.statesLine}>
            {t("passport.statesVisited", {
              visited: visited.size,
              total: regions.length,
            })}
          </Text>
        </>
      ) : null}
      {seals.length === 0 && map ? (
        <Text style={styles.emptyBody}>
          {t("passport.emptyHomeBody", {
            country: countryDisplayName(home, locale),
          })}
        </Text>
      ) : null}
      <View style={styles.sealGrid}>
        {seals.map((seal) => (
          <PressableScale key={seal.region} onPress={() => onOpen(seal)} accessibilityRole="button" accessibilityLabel={names.get(seal.region) ?? seal.region}>
            <StateSeal title={names.get(seal.region) ?? seal.region} bottom={stampDate(seal.first, locale)} visits={seal.visits} viaApp={seal.viaApp} width={sealWidth} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

/** A state seal: its visits, and the past entries behind it, which can be removed here. */
function SealSheet({ home, seal, onClose }: { home: string; seal: Seal | null; onClose: () => void }) {
  const { t, locale } = useLocalization();
  const { c: palette, f: fonts } = useAura();
  const entries = usePassportStore((state) => state.entries);
  const removeEntry = usePassportStore((state) => state.removeEntry);
  if (!seal) return null;
  const name = countryRegions(home).find((region) => region.key === seal.region)?.name ?? seal.region;
  const past = entries.filter((entry) => entry.country === home && entry.region === seal.region);
  return (
    <AuraSheet visible onClose={onClose} title={name}>
      <View style={styles.sheet}>
        <StateSeal title={name} bottom={stampDate(seal.first, locale)} visits={seal.visits} viaApp={seal.viaApp} width={180} />
        <Text style={[styles.sheetSub, { color: palette.textSoft, fontFamily: fonts.regular }]}>
          {seal.viaApp ? t("passport.viaApp") : t("passport.fromMemory")}
        </Text>
        {past.map((entry) => (
          <View key={entry.id} style={[styles.pastRow, { borderColor: palette.hairline }]}>
            <Text numberOfLines={1} style={[styles.pastText, { color: palette.text, fontFamily: fonts.medium }]}>
              {[entry.place, stampDate(entry.month ? `${entry.year}-${String(entry.month).padStart(2, "0")}` : String(entry.year), locale)].filter(Boolean).join(", ")}
            </Text>
            <PressableScale onPress={() => removeEntry(entry.id)} accessibilityRole="button" accessibilityLabel={t("passport.remove")} style={styles.round}>
              <Icon name="trash" size={15} color={palette.text} />
            </PressableScale>
          </View>
        ))}
      </View>
    </AuraSheet>
  );
}

function StampSheet({ stamp, onClose }: { stamp: Stamp | null; onClose: () => void }) {
  const { t, locale } = useLocalization();
  const { c: palette, f: fonts } = useAura();
  const router = useRouter();
  const removeEntry = usePassportStore((state) => state.removeEntry);
  const trip = useTripsStore((state) => (stamp?.tripId ? state.trips.find((item) => item.id === stamp.tripId) : undefined));
  if (!stamp)
    return (
      <AuraSheet visible={false} onClose={onClose}>
        {null}
      </AuraSheet>
    );
  const country = countryDisplayName(stamp.country, locale);
  const canReplay = trip && getTripStatus(trip) === "complete";
  return (
    <AuraSheet visible onClose={onClose} title={country}>
      <View style={styles.sheet}>
        <PassportStamp
          seed={stamp.country}
          tiltSeed={stamp.id}
          title={country}
          top={stamp.place}
          bottom={stampDate(stamp.date, locale)}
          viaApp={stamp.viaApp}
          pending={stamp.pending}
          pendingLabel={t("passport.pending")}
          width={220}
        />
        <Text style={[styles.sheetLine, { color: palette.text, fontFamily: fonts.semibold }]}>
          {stamp.place ? t("passport.arrivedIn", { place: stamp.place }) : country}
        </Text>
        <Text style={[styles.sheetSub, { color: palette.textSoft, fontFamily: fonts.regular }]}>
          {stamp.pending ? t("passport.pendingBody") : stamp.viaApp ? t("passport.viaApp") : t("passport.fromMemory")}
        </Text>
        {canReplay ? (
          <AuraButton
            label={t("recap.watchReplay")}
            icon="play"
            onPress={() => {
              onClose();
              router.push({
                pathname: "/trip-recap/[id]",
                params: { id: trip.id, source: "trips" },
              });
            }}
          />
        ) : null}
        {stamp.pastId ? (
          <AuraButton
            label={t("passport.remove")}
            icon="trash"
            variant="secondary"
            onPress={() => {
              removeEntry(stamp.pastId!);
              onClose();
            }}
          />
        ) : null}
      </View>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    fontFamily: f.semibold,
    fontSize: 34,
    letterSpacing: -1.2,
    color: c.text,
  },
  round: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceStrong,
  },
  bookWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  pad: { flex: 1, padding: 22 },
  pageLabel: {
    fontFamily: f.medium,
    fontSize: 13.5,
    color: c.textMuted,
    marginBottom: 14,
  },
  cover: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  coverTitle: {
    fontFamily: f.semibold,
    fontSize: 40,
    letterSpacing: -1.2,
    color: c.text,
    marginTop: 10,
  },
  coverName: { fontFamily: f.medium, fontSize: 17, color: c.textSoft },
  coverHome: { fontFamily: f.regular, fontSize: 15, color: c.textMuted },
  coverBrand: {
    position: "absolute",
    bottom: 26,
    fontFamily: f.semibold,
    fontSize: 14,
    letterSpacing: 2,
    color: c.textMuted,
  },
  identity: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    marginBottom: 22,
  },
  photo: {
    width: 84,
    height: 104,
    borderRadius: 14,
    backgroundColor: c.surfaceStrong,
    borderWidth: 1,
    borderColor: c.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  photoText: { fontFamily: f.semibold, fontSize: 38, color: c.textSoft },
  fieldLabel: { fontFamily: f.regular, fontSize: 12.5, color: c.textMuted },
  fieldValue: {
    fontFamily: f.semibold,
    fontSize: 18,
    color: c.text,
    marginTop: 2,
  },
  gapTop: { marginTop: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 18 },
  cell: { width: "50%" },
  bigValue: {
    fontFamily: f.semibold,
    fontSize: 30,
    letterSpacing: -1,
    color: c.text,
    marginTop: 2,
  },
  stampGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 6,
  },
  empty: { justifyContent: "center", alignItems: "flex-start", gap: 10 },
  emptyTitle: {
    fontFamily: f.semibold,
    fontSize: 24,
    letterSpacing: -0.6,
    color: c.text,
  },
  emptyBody: {
    fontFamily: f.regular,
    fontSize: 15,
    lineHeight: 21,
    color: c.textSoft,
    marginBottom: 8,
  },
  map: { alignItems: "center", marginBottom: 6 },
  statesLine: {
    fontFamily: f.medium,
    fontSize: 15,
    color: c.text,
    marginBottom: 10,
  },
  sealGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 14, gap: 14 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.hairline },
  dotOn: { backgroundColor: c.text, width: 16 },
  sheet: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sheetLine: { fontSize: 18 },
  pastRow: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  pastText: { flex: 1, fontSize: 15 },
  sheetSub: { fontSize: 14.5, textAlign: "center", marginBottom: 6 },
});
