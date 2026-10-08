import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraDateField, AuraField, AuraSegmented, AuraSheet, AuraSwitch, Icon, PressableScale, showAlert, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { CURRENCY_OPTIONS } from "@/utils/currency";
import { fetchExchangeRate } from "@/features/expenses/services/currencyConversion";
import { carryToTrip, loadForex } from "@/features/expenses/services/forexPockets";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";
import { localeDecimalSeparator, parseAmountInput } from "@/features/expenses/utils/amountInput";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { loadFee, sparePockets, type ForexPocket, type PocketKind } from "@/features/expenses/utils/forex";
import { formatMoney } from "@/features/expenses/utils/money";
import { tripForeignCurrencies } from "@/features/expenses/utils/tripCurrencies";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";

/** Adds forex to a trip (a new pocket), or tops up `pocket`. */
export function AddForexSheet({ visible, onClose, trip, pocket }: { visible: boolean; onClose: () => void; trip: Trip; pocket?: ForexPocket | null }) {
  const { t } = useLocalization();
  return (
    <AuraSheet visible={visible} onClose={onClose} title={pocket ? t("forex.topUpTitle") : t("forex.addTitle")}>
      {visible ? <AddForexBody onClose={onClose} trip={trip} pocket={pocket ?? null} /> : null}
    </AuraSheet>
  );
}

function rateLabel(rate: number, separator: string): string {
  return String(Number(rate.toPrecision(rate < 1 ? 4 : 6))).replace(".", separator);
}

function AddForexBody({ onClose, trip, pocket }: { onClose: () => void; trip: Trip; pocket: ForexPocket | null }) {
  const { c, f } = useAura();
  const { t, locale, currency: deviceCurrency, formatCurrency } = useLocalization();
  const separator = useMemo(() => localeDecimalSeparator(locale), [locale]);
  const suggested = useMemo(() => tripForeignCurrencies(trip, deviceCurrency), [trip, deviceCurrency]);
  const [kind, setKind] = useState<PocketKind>(pocket?.kind ?? "cash");
  // Paid in the trip's currency (what its totals are in), unless the trip is kept in the forex currency itself.
  const homeFor = (code: string) => pocket?.homeCurrency ?? (trip.currency !== code ? trip.currency : deviceCurrency);
  const options = [...new Set([...suggested, ...CURRENCY_OPTIONS.map((option) => option.code)])].filter((code) => code !== homeFor(code));
  const [currency, setCurrency] = useState(pocket?.currency ?? options[0]);
  const home = homeFor(currency);
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState("");
  const [date, setDate] = useState(() => new Date());
  const [rateText, setRateText] = useState("");
  const [rateTouched, setRateTouched] = useState(false);
  const rateTouchedRef = useRef(false);
  const [fetched, setFetched] = useState<{ key: string; ok: boolean } | null>(null);
  const [logFee, setLogFee] = useState(true);
  const allPockets = usePocketsStore((state) => state.pockets);
  const trips = useTripsStore((state) => state.trips);
  const spares = pocket ? [] : sparePockets(allPockets).filter((spare) => spare.currency === currency && spare.groupId !== trip.id);

  const day = toLocalDayKey(date);
  const rateKey = `${currency}|${home}|${day}`;
  const rateState = fetched?.key !== rateKey ? "loading" : fetched.ok ? "ready" : "missing";
  useEffect(() => {
    let cancelled = false;
    const key = `${currency}|${home}|${day}`;
    fetchExchangeRate(currency, home, day)
      .then((rate) => {
        if (cancelled) return;
        setFetched({ key, ok: true });
        if (!rateTouchedRef.current) setRateText(rateLabel(rate.rate, separator));
      })
      .catch(() => {
        if (!cancelled) setFetched({ key, ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, [currency, home, day, separator]);

  const amountValue = parseAmountInput(amount, separator);
  const paidValue = parseAmountInput(paid, separator);
  const rateValue = parseAmountInput(rateText, separator);
  const fee =
    amountValue > 0 && paidValue > 0 && rateValue > 0 ? loadFee({ amount: amountValue, paid: paidValue, marketRate: rateValue, homeCurrency: home }) : null;
  const money = (value: number, code: string) => formatMoney(formatCurrency, value, code);

  const chooseCurrency = (code: string) => {
    setCurrency(code);
    setRateTouched(false);
    rateTouchedRef.current = false;
    setRateText("");
  };

  const save = () => {
    const marketRate = rateValue > 0 ? rateValue : paidValue > 0 && amountValue > 0 ? paidValue / amountValue : NaN;
    if (!(amountValue > 0) || !(marketRate > 0)) {
      showAlert(t("forex.invalidTitle"), t("forex.invalidBody"));
      return;
    }
    loadForex(
      {
        groupId: trip.id,
        kind,
        currency,
        homeCurrency: home,
        amount: amountValue,
        paid: paidValue > 0 ? paidValue : amountValue * marketRate,
        marketRate,
        date: date.toISOString(),
        logFee,
      },
      pocket?.id,
    );
    onClose();
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      {spares.map((spare) => (
        <PressableScale
          key={spare.id}
          onPress={() => {
            carryToTrip(spare, trip.id);
            onClose();
          }}
          accessibilityRole="button"
          style={[styles.spare, { backgroundColor: c.surface, borderColor: c.hairline }]}
        >
          <Icon name="swap" size={16} color={c.text} />
          <Text style={[styles.spareText, { color: c.text, fontFamily: f.medium }]}>
            {t("forex.bringSpare", { amount: money(spare.closed?.leftover ?? 0, spare.currency), trip: trips.find((entry) => entry.id === spare.groupId)?.name ?? "—" })}
          </Text>
          <Text style={[styles.spareAction, { color: c.text, fontFamily: f.semibold }]}>{t("forex.bring")}</Text>
        </PressableScale>
      ))}

      {pocket ? null : (
        <>
          <AuraSegmented
            options={[
              { value: "cash", label: t("forex.kindCash") },
              { value: "card", label: t("forex.kindCard") },
            ]}
            value={kind}
            onChange={setKind}
          />
          <View style={styles.group}>
            <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("forex.currency")}</Text>
            <View style={styles.chips}>
              {options.map((code) => (
                <AuraChip key={code} label={code} selected={code === currency} onPress={() => chooseCurrency(code)} />
              ))}
            </View>
          </View>
        </>
      )}

      <AuraField
        large
        label={t("forex.amount")}
        value={amount}
        onChangeText={(value) => setAmount(value.replace(/[^0-9.,]/g, ""))}
        placeholder={`0${separator}00`}
        keyboardType="decimal-pad"
        suffix={<Text style={[styles.affix, { color: c.textSoft, fontFamily: f.semibold }]}>{currency}</Text>}
        autoFocus={Boolean(pocket)}
      />
      <View style={styles.group}>
        <AuraField
          label={t("forex.paid", { currency: home })}
          value={paid}
          onChangeText={(value) => setPaid(value.replace(/[^0-9.,]/g, ""))}
          placeholder={`0${separator}00`}
          keyboardType="decimal-pad"
        />
        <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("forex.paidHint")}</Text>
      </View>
      <AuraDateField label={t("forex.date")} value={date} onChange={setDate} maximumDate={new Date()} />
      <View style={styles.group}>
        <AuraField
          label={t("forex.marketRate")}
          labelAction={
            rateState === "loading" && !rateTouched ? (
              <ActivityIndicator size="small" color={c.textSoft} />
            ) : (
              <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("forex.marketRateUnit", { from: currency, to: home })}</Text>
            )
          }
          value={rateText}
          onChangeText={(value) => {
            setRateTouched(true);
            rateTouchedRef.current = true;
            setRateText(value.replace(/[^0-9.,]/g, ""));
          }}
          placeholder={rateState === "loading" ? t("forex.rateLoading") : `0${separator}00`}
          keyboardType="decimal-pad"
        />
        {rateState === "missing" && !rateTouched ? (
          <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("forex.rateMissing")}</Text>
        ) : null}
      </View>

      {fee ? (
        fee.fee > 0 ? (
          <View style={[styles.fee, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <View style={styles.feeText}>
              <Text style={[styles.feeTitle, { color: c.text, fontFamily: f.semibold }]}>{t("forex.fee", { amount: money(fee.fee, home) })}</Text>
              <Text style={[styles.hint, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.feeDetail", { pct: fee.pct.toFixed(1) })}</Text>
            </View>
            <AuraSwitch value={logFee} onValueChange={setLogFee} accessibilityLabel={t("forex.fee", { amount: money(fee.fee, home) })} />
          </View>
        ) : (
          <Text style={[styles.hint, { color: c.textSoft, fontFamily: f.regular }]}>{t("forex.noFee")}</Text>
        )
      ) : null}

      <AuraButton label={pocket ? t("forex.topUp") : t("forex.add")} icon="check" onPress={save} style={styles.save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 16, gap: 18 },
  group: { gap: 8 },
  label: { fontSize: 13.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  affix: { fontSize: 18 },
  hint: { fontSize: 12.5, lineHeight: 17 },
  fee: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  feeText: { flex: 1, gap: 3 },
  feeTitle: { fontSize: 14.5 },
  spare: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, minHeight: 52 },
  spareText: { flex: 1, fontSize: 14 },
  spareAction: { fontSize: 14 },
  save: { marginTop: 4 },
});
