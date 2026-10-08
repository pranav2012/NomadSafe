import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraCard, AuraProgressBar, Icon, PressableScale, useAura } from "@/atoms";
import { auraHitSlop, auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { AddForexSheet } from "@/features/expenses/components/AddForexSheet";
import { PocketSheet, useClosedSummary } from "@/features/expenses/components/PocketSheet";
import { carryToTrip, dismissForexPrompt } from "@/features/expenses/services/forexPockets";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useForexSheetStore } from "@/features/expenses/store/forexSheetStore";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";
import { pocketBalance, sparePockets, type ForexPocket } from "@/features/expenses/utils/forex";
import { formatMoney } from "@/features/expenses/utils/money";
import { tripForeignCurrencies } from "@/features/expenses/utils/tripCurrencies";
import { useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { getTripStatus } from "@/features/trips/utils/dates";

/** A trip's forex pockets, kept leftovers it could use, and a "Got forex?" prompt on international trips. */
export function TripForex({ trip }: { trip: Trip }) {
  const { c, f } = useAura();
  const { t, currency: home, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  const allPockets = usePocketsStore((state) => state.pockets);
  const dismissed = usePocketsStore((state) => state.dismissedPrompts.includes(trip.id));
  const trips = useTripsStore((state) => state.trips);
  const [adding, setAdding] = useState(false);
  const [topUp, setTopUp] = useState<ForexPocket | null>(null);
  const addingFromMenu = useForexSheetStore((state) => state.addingTripId === trip.id);
  const pockets = allPockets.filter((pocket) => pocket.groupId === trip.id);
  const foreign = useMemo(() => tripForeignCurrencies(trip, home), [trip, home]);
  const status = getTripStatus(trip);
  const spares = status === "complete" ? [] : sparePockets(allPockets).filter((spare) => spare.groupId !== trip.id && foreign.includes(spare.currency));
  const showPrompt = pockets.length === 0 && status !== "complete" && foreign.length > 0 && !dismissed;
  const money = (amount: number, currency: string) => formatMoney(formatCurrency, amount, currency);

  const hasContent = pockets.length > 0 || spares.length > 0 || showPrompt;

  return (
    <View style={hasContent ? styles.root : undefined}>
      {pockets.map((pocket) => (
        <PocketCard key={pocket.id} pocket={pocket} tripOver={status === "complete"} />
      ))}

      {spares.map((spare) => (
        <PressableScale
          key={spare.id}
          onPress={() => plus.run("forex", () => carryToTrip(spare, trip.id))}
          accessibilityRole="button"
          style={[styles.row, { backgroundColor: c.surface, borderColor: c.hairline }]}
        >
          <Icon name="swap" size={16} color={c.text} />
          <Text style={[styles.rowText, { color: c.text, fontFamily: f.medium }]}>
            {t("forex.bringSpare", { amount: money(spare.closed?.leftover ?? 0, spare.currency), trip: trips.find((entry) => entry.id === spare.groupId)?.name ?? "—" })}
          </Text>
          <Text style={[styles.rowAction, { color: c.text, fontFamily: f.semibold }]}>{t("forex.bring")}</Text>
        </PressableScale>
      ))}

      {showPrompt ? (
        <AuraCard style={styles.prompt}>
          <View style={styles.promptHead}>
            <Icon name={plus.isPlus ? "banknote" : "lock"} size={18} color={c.text} />
            <Text style={[styles.promptTitle, { color: c.text, fontFamily: f.semibold }]}>
              {foreign.length === 1 ? t("forex.prompt", { currency: foreign[0] }) : t("forex.promptAny")}
            </Text>
            <PressableScale
              onPress={() => dismissForexPrompt(trip.id)}
              hitSlop={auraHitSlop(18)}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Icon name="x" size={16} color={c.textMuted} />
            </PressableScale>
          </View>
          <Text style={[styles.promptBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.promptBody")}</Text>
          <AuraButton label={t("forex.add")} icon="plus" variant="secondary" size="md" onPress={() => plus.run("forex", () => setAdding(true))} style={styles.promptButton} />
        </AuraCard>
      ) : null}

      <AddForexSheet visible={adding || addingFromMenu || topUp !== null} onClose={() => {
          setAdding(false);
          setTopUp(null);
          useForexSheetStore.getState().stopAdding();
        }} trip={trip} pocket={topUp} />
      <PocketSheet onTopUp={setTopUp} />
    </View>
  );
}

function PocketCard({ pocket, tripOver }: { pocket: ForexPocket; tripOver: boolean }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  const expenses = useExpensesStore((state) => state.expenses);
  const open = useForexSheetStore((state) => state.open);
  const balance = pocketBalance(pocket, expenses);
  const money = (amount: number) => formatMoney(formatCurrency, amount, pocket.currency);
  const isCard = pocket.kind === "card";
  const askLeftover = tripOver && !pocket.closed && balance.left > 0;
  const closedSummary = useClosedSummary(pocket);

  return (
    <PressableScale onPress={() => open(pocket.id)} pressedScale={0.98} accessibilityRole="button" style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <View style={styles.cardHead}>
        <Icon name={isCard ? "creditCard" : "banknote"} size={16} color={c.textSoft} />
        <Text style={[styles.cardLabel, { color: c.textSoft, fontFamily: f.medium }]}>
          {t("forex.pocketName", { kind: t(isCard ? "forex.kindCard" : "forex.kindCash"), currency: pocket.currency })}
        </Text>
        <Icon name="chevronRight" size={13} color={c.textMuted} />
      </View>
      <Text style={[styles.left, { color: balance.left < 0 ? auraSignal.amber : c.text, fontFamily: f.semibold }]}>{t("forex.left", { amount: money(balance.left) })}</Text>
      <Text style={[styles.sub, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.ofLoaded", { loaded: money(balance.loaded), spent: money(balance.spent) })}</Text>
      {pocket.closed ? null : <AuraProgressBar value={balance.loaded > 0 ? balance.spent / balance.loaded : 0} style={styles.progress} />}
      {balance.spent > 0 ? (
        <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
          {t("forex.spentValue", { amount: formatMoney(formatCurrency, balance.spentValue, pocket.homeCurrency) })}
        </Text>
      ) : null}
      {closedSummary ? <Text style={[styles.sub, { color: c.text, fontFamily: f.medium }]}>{closedSummary}</Text> : null}
      {askLeftover ? (
        <View style={styles.leftover}>
          <Text style={[styles.sub, { color: c.text, fontFamily: f.medium }]}>{t("forex.leftoverPrompt", { amount: money(balance.left) })}</Text>
          <AuraButton label={t("forex.leftover")} size="md" variant="secondary" onPress={() => plus.run("forex", () => open(pocket.id, "leftover"))} style={styles.leftoverButton} />
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 22, gap: 12 },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardLabel: { flex: 1, fontSize: 13.5 },
  left: { fontSize: 26, letterSpacing: -0.8, marginTop: 8 },
  sub: { fontSize: 13, marginTop: 4 },
  progress: { marginTop: 12 },
  leftover: { marginTop: 14, gap: 10 },
  leftoverButton: { alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, minHeight: 52 },
  rowText: { flex: 1, fontSize: 14 },
  rowAction: { fontSize: 14 },
  prompt: { gap: 8 },
  promptHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  promptTitle: { flex: 1, fontSize: 15.5 },
  promptBody: { fontSize: 13.5, lineHeight: 19 },
  promptButton: { alignSelf: "flex-start", marginTop: 4 },
});
