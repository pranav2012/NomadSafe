import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraField, AuraSheet, Icon, PressableScale, showToast, useAura } from "@/atoms";
import { searchOfflineDestinations, type DestinationOption } from "@/features/trips/data/destinations";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { placeCountry } from "../hooks/usePassport";
import { usePassportStore } from "../store/passportStore";
import { regionAt } from "../utils/regions";

const YEARS_BACK = 50;

/** Where a search pick is: a country option carries its code in the id, a city its coordinates. */
function resolvePick(option: DestinationOption): { country: string; region: string | null } | null {
  if (option.kind === "country") return { country: option.id.replace("country-", ""), region: null };
  if (!option.coordinates) return null;
  const country = placeCountry(option.coordinates);
  if (!country) return null;
  return { country, region: regionAt(country, option.coordinates.latitude, option.coordinates.longitude)?.key ?? null };
}

/** Adds travel from before NomadSafe: a country or city, and roughly when. */
export function AddPastTravelSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const addEntry = usePassportStore((state) => state.addEntry);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<DestinationOption | null>(null);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState<number | null>(null);
  const results = picked ? [] : searchOfflineDestinations(query, locale, [], 6);
  const months = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { month: "short" });
    return Array.from({ length: 12 }, (_, i) => format.format(new Date(2026, i, 1)));
  }, [locale]);

  const reset = () => {
    setQuery("");
    setPicked(null);
    setYear(thisYear);
    setMonth(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const save = () => {
    const place = picked ? resolvePick(picked) : null;
    if (!picked || !place) return;
    addEntry({ country: place.country, region: place.region, place: picked.label, year, month });
    track("past_travel_added", { has_region: place.region !== null, has_month: month !== null });
    showToast(t("passport.added"));
    close();
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={close}
      title={t("passport.addTitle")}
      subtitle={t("passport.addSubtitle")}
      footer={<AuraButton label={t("passport.addSave")} onPress={save} disabled={!picked} />}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {picked ? (
          <View style={styles.chips}>
            <AuraChip label={picked.label} icon={picked.kind === "country" ? "globe" : "mapPin"} selected onRemove={() => setPicked(null)} />
          </View>
        ) : (
          <>
            <AuraField value={query} onChangeText={setQuery} placeholder={t("passport.searchPlaceholder")} autoCorrect={false} autoFocus />
            {results.map((option) => (
              <PressableScale
                key={option.id}
                onPress={() => {
                  setPicked(option);
                  setQuery("");
                }}
                accessibilityRole="button"
                style={[styles.result, { borderColor: c.hairline }]}
              >
                <Icon name={option.kind === "country" ? "globe" : "mapPin"} size={16} color={c.textSoft} />
                <Text numberOfLines={1} style={[styles.resultText, { color: c.text, fontFamily: f.medium }]}>
                  {option.label}
                </Text>
              </PressableScale>
            ))}
          </>
        )}

        <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("passport.year")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i).map((value) => (
            <AuraChip key={value} label={String(value)} selected={value === year} onPress={() => setYear(value)} />
          ))}
        </ScrollView>

        <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("passport.month")}</Text>
        <View style={[styles.chips, styles.wrap]}>
          <AuraChip label={t("passport.anyMonth")} selected={month === null} onPress={() => setMonth(null)} />
          {months.map((label, i) => (
            <AuraChip key={label} label={label} selected={month === i + 1} onPress={() => setMonth(i + 1)} />
          ))}
        </View>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  result: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  resultText: { flex: 1, fontSize: 15.5 },
  label: { fontSize: 13.5, marginTop: 10 },
  chips: { flexDirection: "row", gap: 8 },
  wrap: { flexWrap: "wrap" },
});
