import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraSheet, Icon, type IconName, PressableScale, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import type { PermissionReadiness, SafetyReadiness } from "../hooks/useSafetyReadiness";

const READY = "#3DDC97";

interface Props {
  visible: boolean;
  onClose: () => void;
  readiness: SafetyReadiness;
  onFixForeground: () => void;
  onFixBackground: () => void;
  onFixNotifications: () => void;
  onFixBattery: () => void;
}

interface Row {
  key: string;
  icon: IconName;
  tone: string;
  title: string;
  sub: string;
  ready: boolean;
  action: { label: string; onPress: () => void };
}

/** The phone settings safety features rely on, each with a one-tap fix. */
export function ReadinessSheet({ visible, onClose, readiness, onFixForeground, onFixBackground, onFixNotifications, onFixBattery }: Props) {
  const { c, f } = useAura();
  const { t } = useLocalization();

  const permissionAction = (state: PermissionReadiness, askLabel: string, onPress: () => void) => ({
    label: state === "blocked" ? t("safety.actionOpenSettings") : askLabel,
    onPress,
  });

  const rows: Row[] = [
    {
      key: "location",
      icon: "mapPin",
      tone: "#22C7B8",
      title: t("safety.readinessLocation"),
      sub: readiness.foreground === "granted" ? t("safety.readinessLocationOn") : t("safety.readinessLocationOff"),
      ready: readiness.foreground === "granted",
      action: permissionAction(readiness.foreground, t("safety.actionAllow"), onFixForeground),
    },
    {
      key: "background",
      icon: "users",
      tone: "#8B97FF",
      title: t("safety.readinessBackground"),
      sub: readiness.background === "granted" ? t("safety.readinessBackgroundOn") : t("safety.readinessBackgroundOff"),
      ready: readiness.background === "granted",
      action: { label: t("safety.actionSetUp"), onPress: onFixBackground },
    },
    {
      key: "notifications",
      icon: "bell",
      tone: "#FFB547",
      title: t("safety.readinessNotifications"),
      sub: readiness.notifications === "granted" ? t("safety.readinessNotificationsOn") : t("safety.readinessNotificationsOff"),
      ready: readiness.notifications === "granted",
      action: permissionAction(readiness.notifications, t("safety.actionTurnOn"), onFixNotifications),
    },
  ];
  if (readiness.batteryOptimized !== null) {
    rows.push({
      key: "battery",
      icon: "battery",
      tone: "#FF7A6B",
      title: t("safety.readinessBattery"),
      sub: readiness.batteryOptimized ? t("safety.readinessBatteryOff") : t("safety.readinessBatteryOn"),
      ready: !readiness.batteryOptimized,
      action: { label: t("safety.actionOpenSettings"), onPress: onFixBattery },
    });
  }

  return (
    <AuraSheet visible={visible} onClose={onClose} title={t("safety.readinessTitle")} subtitle={t("safety.readinessSubtitle")}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {rows.map((row, i) => (
          <View key={row.key} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}>
            <View style={[styles.icon, { backgroundColor: `${row.tone}22` }]}>
              <Icon name={row.icon} size={17} color={row.tone} strokeWidth={1.9} />
            </View>
            <View style={styles.text}>
              <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{row.title}</Text>
              <Text style={[styles.sub, { color: row.ready ? c.textMuted : c.textSoft, fontFamily: f.regular }]}>{row.sub}</Text>
            </View>
            {row.ready ? (
              <View style={[styles.check, { backgroundColor: `${READY}22` }]} accessible accessibilityLabel={t("safety.readinessReadyA11y")}>
                <Icon name="check" size={14} color={READY} strokeWidth={2.4} />
              </View>
            ) : (
              <PressableScale
                onPress={row.action.onPress}
                accessibilityRole="button"
                accessibilityLabel={`${row.action.label}: ${row.title}`}
                hitSlop={6}
                style={[styles.action, { backgroundColor: c.inverse }]}
              >
                <Text style={[styles.actionText, { color: c.onInverse, fontFamily: f.semibold }]}>{row.action.label}</Text>
              </PressableScale>
            )}
          </View>
        ))}
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15 },
  sub: { fontSize: 12.5, lineHeight: 17 },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  action: { height: 32, paddingHorizontal: 13, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 12.5 },
});
