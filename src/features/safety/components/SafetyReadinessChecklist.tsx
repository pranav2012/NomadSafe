import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraCard } from "@/components/aura/AuraCard";
import { AuraSection } from "@/components/aura/AuraSection";
import { useAura } from "@/components/aura/useAura";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { summarizeReadiness, type PermissionReadiness, type SafetyReadiness } from "../hooks/useSafetyReadiness";
import type { EmergencyNumbers } from "../services/emergencyNumberService";

const ALERT = auraStatusAccent.alert;
const READY = "#3DDC97";

interface Props {
  readiness: SafetyReadiness;
  emergency: EmergencyNumbers | null;
  onFixForeground: () => void;
  onFixBackground: () => void;
  onFixNotifications: () => void;
  onFixContacts: () => void;
  onFixBattery: () => void;
  onCallEmergency: () => void;
}

interface Row {
  key: string;
  icon: IconName;
  title: string;
  sub: string;
  ready: boolean;
  action?: { label: string; onPress: () => void; danger?: boolean };
  tone: string;
}

/** Safety readiness rows with live status and a one-tap fix for each. */
export function SafetyReadinessChecklist({
  readiness,
  emergency,
  onFixForeground,
  onFixBackground,
  onFixNotifications,
  onFixContacts,
  onFixBattery,
  onCallEmergency,
}: Props) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const { ready, total } = summarizeReadiness(readiness);

  const permissionAction = (state: PermissionReadiness, askLabel: string, onPress: () => void) =>
    state === "granted"
      ? undefined
      : { label: state === "blocked" ? t("safety.actionOpenSettings") : askLabel, onPress };

  const permissionSub = (state: PermissionReadiness, on: string, off: string) =>
    state === "granted" ? on : state === "blocked" ? t("safety.readinessBlocked") : off;

  const rows: Row[] = [
    {
      key: "location",
      icon: "mapPin",
      tone: "#22C7B8",
      title: t("safety.readinessLocation"),
      sub: permissionSub(readiness.foreground, t("safety.readinessLocationOn"), t("safety.readinessLocationOff")),
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
      action: readiness.background === "granted"
        ? undefined
        : { label: t("safety.actionSetUp"), onPress: onFixBackground },
    },
    {
      key: "notifications",
      icon: "bell",
      tone: "#FFB547",
      title: t("safety.readinessNotifications"),
      sub: permissionSub(
        readiness.notifications,
        t("safety.readinessNotificationsOn"),
        t("safety.readinessNotificationsOff"),
      ),
      ready: readiness.notifications === "granted",
      action: permissionAction(readiness.notifications, t("safety.actionTurnOn"), onFixNotifications),
    },
    {
      key: "contacts",
      icon: "messageCircle",
      tone: "#FF7A6B",
      title: t("safety.readinessContacts"),
      sub: readiness.contactsWithPhone > 0
        ? t("safety.readinessContactsOn", { count: readiness.contactsWithPhone })
        : t("safety.readinessContactsOff"),
      ready: readiness.contactsWithPhone > 0,
      action: readiness.contactsWithPhone > 0
        ? undefined
        : { label: t("safety.actionAdd"), onPress: onFixContacts },
    },
  ];

  if (readiness.batteryOptimized !== null) {
    rows.push({
      key: "battery",
      icon: "battery",
      tone: "#FFB547",
      title: t("safety.readinessBattery"),
      sub: readiness.batteryOptimized ? t("safety.readinessBatteryOff") : t("safety.readinessBatteryOn"),
      ready: !readiness.batteryOptimized,
      action: readiness.batteryOptimized
        ? { label: t("safety.actionOpenSettings"), onPress: onFixBattery }
        : undefined,
    });
  }

  const emergencyNumber = emergency?.general ?? "112";
  rows.push({
    key: "emergency",
    icon: "phone",
    tone: ALERT,
    title: t("safety.readinessEmergency"),
    sub: emergency?.countryCode
      ? t("safety.readinessEmergencyCountry", { number: emergencyNumber, country: emergency.countryName ?? emergency.countryCode })
      : t("safety.readinessEmergencyDefault", { number: emergencyNumber }),
    ready: false,
    action: { label: t("safety.actionCall"), onPress: onCallEmergency, danger: true },
  });

  return (
    <View>
      <AuraSection
        title={t("safety.readinessTitle")}
        action={
          <Text style={[styles.summary, { color: ready === total ? READY : c.textMuted, fontFamily: f.medium }]} accessibilityLiveRegion="polite">
            {t("safety.readinessSummary", { ready, total })}
          </Text>
        }
      />
      <AuraCard style={styles.list}>
        {rows.map((row, i) => (
          <View key={row.key} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}>
            <View style={[styles.icon, { backgroundColor: `${row.tone}22` }]}>
              <Icon name={row.icon} size={17} color={row.tone} strokeWidth={1.9} />
            </View>
            <View style={styles.body}>
              <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{row.title}</Text>
              <Text style={[styles.sub, { color: row.ready ? c.textMuted : c.textSoft, fontFamily: f.regular }]}>{row.sub}</Text>
            </View>
            {row.action && !row.ready ? (
              <PressableScale
                onPress={row.action.onPress}
                accessibilityRole="button"
                accessibilityLabel={
                  row.key === "emergency" ? t("sos.callEmergency", { number: emergencyNumber }) : `${row.action.label}: ${row.title}`
                }
                hitSlop={6}
                style={[styles.action, { backgroundColor: row.action.danger ? ALERT : c.inverse }]}
              >
                <Text style={[styles.actionText, { color: row.action.danger ? "#FFFFFF" : c.onInverse, fontFamily: f.semibold }]}>
                  {row.action.label}
                </Text>
              </PressableScale>
            ) : (
              <View style={[styles.check, { backgroundColor: `${READY}22` }]} accessible accessibilityLabel={t("safety.readinessReadyA11y")}>
                <Icon name="check" size={14} color={READY} strokeWidth={2.4} />
              </View>
            )}
          </View>
        ))}
      </AuraCard>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 13 },
  list: { paddingVertical: 4, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 14.5 },
  sub: { fontSize: 12.5, lineHeight: 17 },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  action: { height: 32, paddingHorizontal: 13, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 12.5 },
});
