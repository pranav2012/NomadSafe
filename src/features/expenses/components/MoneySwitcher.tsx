import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { AuraChip, AuraOptionSheet, Icon, PressableScale, useAura, type AuraOption } from "@/atoms";
import { useLocalization } from "@/localization";
import { isArchivedGroup, isTrip, selectMoneyGroups, useTripsStore, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { getTripStatus } from "@/features/trips/utils/dates";

/** Open trips and groups in switcher order: the active trip, groups, other current trips, then ended ones. */
export function useOrderedMoneyGroups() {
  const groups = useTripsStore(selectMoneyGroups);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const visible = groups.filter((group) => !isArchivedGroup(group));
  const otherTrips = visible.filter((group) => isTrip(group) && group.id !== activeTripId);
  return {
    activeTripId,
    active: visible.filter((group) => group.id === activeTripId),
    plain: visible.filter((group) => !isTrip(group)),
    current: otherTrips.filter((trip) => isTrip(trip) && getTripStatus(trip) !== "complete"),
    ended: otherTrips.filter((trip) => isTrip(trip) && getTripStatus(trip) === "complete"),
  };
}

export function moneyGroupLabel(group: MoneyGroup) {
  return isTrip(group) ? group.name : `${group.emoji ?? "👥"} ${group.name}`;
}

/** A trip or group name as the Money title, opening a picker of trips and groups; picking never changes the active trip. */
export function MoneySwitcher({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const groups = useTripsStore(selectMoneyGroups);
  const [open, setOpen] = useState(false);
  const { active, plain, current, ended } = useOrderedMoneyGroups();

  const options: AuraOption<string>[] = [
    ...active.map((group) => ({ value: group.id, label: group.name, detail: t("money.activeTrip") })),
    ...plain.map((group) => ({ value: group.id, label: moneyGroupLabel(group), detail: t("money.people", { count: group.companions.length + 1 }) })),
    ...current.map((group) => ({ value: group.id, label: group.name, detail: t("money.tripBadge") })),
    ...ended.map((group) => ({ value: group.id, label: group.name, detail: t("money.endedTrip") })),
  ];
  const shown = groups.find((group) => group.id === selected);
  const label = shown ? moneyGroupLabel(shown) : "";

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

/** The Overview's quick way into a trip or group: one chip each, then New group. */
export function MoneyGroupChips({ onSelect, onNewGroup }: { onSelect: (id: string) => void; onNewGroup: () => void }) {
  const { t } = useLocalization();
  const { active, plain, current, ended } = useOrderedMoneyGroups();
  const groups = [...active, ...plain, ...current, ...ended];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={chipStyles.scroll} contentContainerStyle={chipStyles.row}>
      {groups.map((group) => (
        <AuraChip key={group.id} label={moneyGroupLabel(group)} icon={isTrip(group) ? "compass" : undefined} onPress={() => onSelect(group.id)} />
      ))}
      <AuraChip label={t("money.newGroup")} icon="plus" onPress={onNewGroup} />
    </ScrollView>
  );
}

const chipStyles = StyleSheet.create({
  scroll: { marginHorizontal: -20, marginBottom: 18 },
  row: { paddingHorizontal: 20, gap: 8 },
});
