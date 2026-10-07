import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon, PressableScale, useAura, type IconName } from "@/atoms";
import { auraRadius, auraSignal, auraSpace, auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { OVERVIEW, useMoneyViewStore } from "@/features/expenses/store/moneyViewStore";
import { useOverallBalance } from "@/features/expenses/hooks/useOverallBalance";
import { formatMoney } from "@/features/expenses/utils/money";
import { useSafetyIntentStore } from "@/features/safety/store/safetyIntentStore";
import { useSafetyStore } from "@/features/safety/store/safetyStore";

const OWED = auraSignal.ready;

/** Home with no trip: your balance across groups (opens Money) and "Get home safe" (opens the safe-arrival timer). */
export function EverydayCards() {
  const { t, formatCurrency, formatTime } = useLocalization();
  const router = useRouter();
  const balance = useOverallBalance();
  const status = useSafetyStore((s) => s.status);
  const checkInEndsAt = useSafetyStore((s) => s.checkInEndsAt);

  const owing = balance.rows.filter((row) => Math.abs(row.net) >= 0.005).length;
  const showBalance = balance.ready && (balance.rows.length > 0 || owing > 0);
  const money = (amount: number) => formatMoney(formatCurrency, amount, balance.currency);
  const timerRunning = status === "active" && checkInEndsAt !== null;

  const openMoney = () => {
    useMoneyViewStore.getState().select(OVERVIEW);
    track("home_card_opened", { card: "balance" });
    router.navigate("/(tabs)/expenses");
  };
  const openSafety = () => {
    if (!timerRunning) useSafetyIntentStore.getState().requestTimer();
    track("home_card_opened", { card: "get_home_safe" });
    router.navigate("/(tabs)/sos");
  };

  return (
    <View style={styles.root}>
      {showBalance ? (
        <Card
          icon="wallet"
          tone={balance.overall > 0 ? OWED : balance.overall < 0 ? auraStatusAccent.alert : undefined}
          title={
            balance.overall > 0
              ? t("home.everyday.owed", { amount: money(balance.overall), count: owing })
              : balance.overall < 0
                ? t("home.everyday.owe", { amount: money(-balance.overall), count: owing })
                : t("home.everyday.settled")
          }
          detail={t("home.everyday.balanceDetail")}
          onPress={openMoney}
        />
      ) : null}
      <Card
        icon="shield"
        tone={timerRunning ? auraStatusAccent.live : undefined}
        title={timerRunning ? t("home.everyday.timerRunning", { time: formatTime(checkInEndsAt) }) : t("home.everyday.getHomeSafe")}
        detail={timerRunning ? t("home.everyday.timerDetail") : t("home.everyday.getHomeSafeDetail")}
        onPress={openSafety}
      />
    </View>
  );
}

function Card({ icon, tone, title, detail, onPress }: { icon: IconName; tone?: string; title: string; detail: string; onPress: () => void }) {
  const { c, f } = useAura();
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}
    >
      <View style={[styles.icon, { backgroundColor: tone ? `${tone}22` : c.surfaceStrong }]}>
        <Icon name={icon} size={18} color={tone ?? c.textSoft} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: tone ?? c.text, fontFamily: f.semibold }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.detail, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <Icon name="chevronRight" size={14} color={c.textMuted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10, marginTop: 18 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: auraRadius.card, borderWidth: StyleSheet.hairlineWidth, padding: auraSpace.cardPad },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 15.5 },
  detail: { fontSize: 13, lineHeight: 18 },
});
