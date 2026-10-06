import React, { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { AuraOptionSheet, Icon, PressableScale, useAura, type AuraOption } from "@/atoms";
import { useLocalization } from "@/localization";
import { isTrip, selectMoneyGroups, useTripsStore } from "@/features/trips/store/tripsStore";
import { getTripStatus } from "@/features/trips/utils/dates";
import { OVERVIEW } from "@/features/expenses/store/moneyViewStore";

/** Money header title: the Overview or a trip/group name, opening a picker; picking never changes the active trip. */
export function MoneySwitcher({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const groups = useTripsStore(selectMoneyGroups);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const [open, setOpen] = useState(false);

  const visible = groups.filter((group) => !group.shared?.archived);
  const active = visible.filter((group) => group.id === activeTripId);
  const plain = visible.filter((group) => !isTrip(group));
  const otherTrips = visible.filter((group) => isTrip(group) && group.id !== activeTripId);
  const current = otherTrips.filter((trip) => isTrip(trip) && getTripStatus(trip) !== "complete");
  const ended = otherTrips.filter((trip) => isTrip(trip) && getTripStatus(trip) === "complete");

  const options: AuraOption<string>[] = [
    { value: OVERVIEW, label: t("money.overview"), detail: t("money.overviewDetail") },
    ...active.map((group) => ({ value: group.id, label: group.name, detail: t("money.activeTrip") })),
    ...plain.map((group) => ({ value: group.id, label: `${group.emoji ?? "👥"} ${group.name}`, detail: t("money.people", { count: group.companions.length + 1 }) })),
    ...current.map((group) => ({ value: group.id, label: group.name, detail: t("money.tripBadge") })),
    ...ended.map((group) => ({ value: group.id, label: group.name, detail: t("money.endedTrip") })),
  ];
  const label = selected === OVERVIEW ? t("money.overview") : groups.find((group) => group.id === selected)?.name ?? t("money.overview");

  return (
    <>
      <PressableScale onPress={() => setOpen(true)} accessibilityRole="button" accessibilityHint={t("money.switchHint")} style={styles.title}>
        <Text style={[styles.text, { color: c.text, fontFamily: f.semibold }]} numberOfLines={1}>
          {label}
        </Text>
        <Icon name="chevronDown" size={18} color={c.textSoft} />
      </PressableScale>
      <AuraOptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t("money.switchTitle")}
        options={options}
        selected={selected}
        onSelect={onSelect}
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  text: { fontSize: 30, letterSpacing: -1, flexShrink: 1 },
});
