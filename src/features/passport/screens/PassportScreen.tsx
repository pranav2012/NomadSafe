import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSharedValue } from "react-native-reanimated";
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
import { DataPage, HomePage, VisaPage, usePassportNumber, type PhotoState } from "../components/PassportPages";
import { PassportPaper } from "../components/PassportPaper";
import { PassportStamp, StateSeal } from "../components/PassportStamp";
import { useHomeCountry, usePassport } from "../hooks/usePassport";
import { usePassportStore } from "../store/passportStore";
import { stampDate, type Seal, type Stamp } from "../utils/passport";
import { countryRegions } from "../utils/regions";

const c = auraDark;
const STAMPS_PER_PAGE = 6;
const SEALS_FIRST_PAGE = 4;
const SEALS_PER_PAGE = 9;

type Page = { kind: "data" } | { kind: "visa"; stamps: Stamp[] } | { kind: "home"; seals: Seal[]; map: boolean };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The passport: closed cover, data page, visa pages with stamps and home pages with state seals. */
export default function PassportScreen() {
  const { source } = useLocalSearchParams<{ source?: "trips" | "replay" }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t, locale } = useLocalization();
  const passport = usePassport();
  const { code: home } = useHomeCountry();
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<Stamp | null>(null);
  const [sealDetail, setSealDetail] = useState<Seal | null>(null);
  const [page, setPage] = useState(0);
  const [pagerHeight, setPagerHeight] = useState(0);

  const onOpened = React.useEffectEvent(() => {
    track("passport_opened", {
      source: source ?? "trips",
      stamps: passport.stamps.length,
    });
  });
  React.useEffect(() => onOpened(), []);

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
    return [{ kind: "data" }, ...(visa.length > 0 ? visa : [[]]).map((stamps): Page => ({ kind: "visa", stamps })), ...homePages];
  }, [home, passport.seals, passport.stamps]);

  const pageHeight = Math.min(pagerHeight - 16, 660);
  const user = useAuthStore((state) => state.user);
  const serial = usePassportNumber();
  const turn = useSharedValue(0);
  const [photo, setPhoto] = useState<PhotoState>(user?.avatarUrl ? "loading" : "none");
  const contentKey = [
    locale,
    home,
    user?.name,
    user?.avatarUrl,
    photo,
    passport.stamps.map((stamp) => `${stamp.id}:${stamp.pending ? 1 : 0}`).join(","),
    passport.seals.map((seal) => `${seal.region}:${seal.visits}`).join(","),
    pages.map((item) => (item.kind === "visa" ? item.stamps.map((stamp) => stamp.id).join(",") : item.kind === "home" ? item.seals.map((seal) => seal.region).join(",") : item.kind)).join("/"),
  ].join("|");

  // Built only when page content changes: re-rendering a leaf mid-flight makes it flash on Android.
  const pageElements = useMemo(
    () =>
      pages.map((item, i) => (
        <PassportPaper key={`${item.kind}-${i}`} width={width - 40} height={pageHeight} page={i + 1} serial={serial}>
          {item.kind === "data" ? <DataPage width={width - 40} height={pageHeight} turn={turn} photo={photo} onPhoto={setPhoto} /> : null}
          {item.kind === "visa" ? <VisaPage stamps={item.stamps} width={width - 40} height={pageHeight} onOpen={setDetail} onAdd={() => setAdding(true)} /> : null}
          {item.kind === "home" && home ? <HomePage home={home} seals={item.seals} map={item.map} width={width - 40} height={pageHeight} onOpen={setSealDetail} /> : null}
        </PassportPaper>
      )),
    [pages, width, pageHeight, serial, turn, photo, home],
  );

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

      <View style={[styles.flex, styles.bookLayer]} onLayout={(event) => setPagerHeight(event.nativeEvent.layout.height)}>
        {pagerHeight > 0 ? (
          <View style={styles.bookWrap}>
            <PassportBook
              width={width - 40}
              height={pageHeight}
              contentKey={contentKey}
              turn={turn}
              onPageChange={setPage}
              pages={pageElements}
            />
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.dots}>
          {[null, ...pages].map((_, i) => (
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
  bookWrap: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "visible" },
  bookLayer: { zIndex: 1, overflow: "visible" },
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
