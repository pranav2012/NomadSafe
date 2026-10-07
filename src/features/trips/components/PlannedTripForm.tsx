import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AuraButton, AuraChip, AuraField, Icon, showToast, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { canCreatePlannedTrip, FREE_TRIP_LIMIT, usePlanStore } from "@/modules/billing";
import { geocodeDestinations, type LatLng } from "@/features/trips/services/geocoding";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { defaultTripName } from "@/features/trips/utils/tripName";

const MONTHS_AHEAD = 9;

/** "YYYY-MM" keys for this month and the next few. */
function upcomingMonths(now = new Date()): string[] {
  return Array.from({ length: MONTHS_AHEAD }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** A trip without dates: a name (defaults from the places, if any) and an optional rough month. */
export function PlannedTripForm({
  destinations,
  knownCoordinates,
  atTripLimit,
  onSaved,
}: {
  destinations: string[];
  knownCoordinates?: ReadonlyMap<string, LatLng | null>;
  atTripLimit: boolean;
  onSaved: () => void;
}) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const router = useRouter();
  const createPlannedTrip = useTripsStore((state) => state.createPlannedTrip);
  const [name, setName] = useState(() => defaultTripName(destinations, t));
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const thisYear = new Date().getFullYear();
  const monthLabel = (key: string) => {
    const date = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
    return new Intl.DateTimeFormat(locale, date.getFullYear() === thisYear ? { month: "short" } : { month: "short", year: "numeric" }).format(date);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    const { plannedTrips } = useTripsStore.getState();
    if (!canCreatePlannedTrip(plannedTrips, usePlanStore.getState())) {
      track("planned_trip_limit_reached");
      router.replace({ pathname: "/paywall", params: { reason: "planned" } });
      return;
    }
    setSaving(true);
    try {
      const destinationCoordinates = destinations.length > 0 ? await geocodeDestinations(destinations, knownCoordinates) : [];
      createPlannedTrip({ name: trimmed, destinations, destinationCoordinates, month });
      track("planned_trip", { action: "created", destinations: destinations.length, had_month: Boolean(month), at_trip_limit: atTripLimit });
      showToast(t("planned.savedToast", { name: trimmed }));
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {atTripLimit ? (
          <View style={[styles.note, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <Icon name="sparkle" size={15} color={c.textSoft} />
            <Text style={[styles.noteText, { color: c.textSoft, fontFamily: f.regular }]}>{t("planned.limitNote", { count: FREE_TRIP_LIMIT })}</Text>
          </View>
        ) : (
          <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("planned.body")}</Text>
        )}
        <AuraField label={t("planned.nameLabel")} value={name} placeholder={t("planned.namePlaceholder")} onChangeText={setName} autoFocus={destinations.length === 0} />
        <View style={styles.group}>
          <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("planned.whenLabel")}</Text>
          <View style={styles.chips}>
            <AuraChip label={t("planned.anyTime")} selected={month === undefined} onPress={() => setMonth(undefined)} />
            {upcomingMonths().map((key) => (
              <AuraChip key={key} label={monthLabel(key)} selected={month === key} onPress={() => setMonth(key)} />
            ))}
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <AuraButton label={t("planned.save")} icon="bookmark" loading={saving} disabled={!name.trim()} onPress={() => void save()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, gap: 18 },
  body: { fontSize: 14.5, lineHeight: 20 },
  note: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  noteText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  group: { gap: 10 },
  label: { fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
});
