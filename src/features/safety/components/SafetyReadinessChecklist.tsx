import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { summarizeReadiness, type PermissionReadiness, type SafetyReadiness } from "../hooks/useSafetyReadiness";
import type { EmergencyNumbers } from "../services/emergencyNumberService";

interface Props {
  theme: NomadTheme;
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
  action?: { label: string; onPress: () => void };
  tone: "teal" | "mustard" | "sky" | "stamp";
}

/** Safety readiness rows with live status and a one-tap fix for each. */
export function SafetyReadinessChecklist({
  theme,
  readiness,
  emergency,
  onFixForeground,
  onFixBackground,
  onFixNotifications,
  onFixContacts,
  onFixBattery,
  onCallEmergency,
}: Props) {
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
      tone: "teal",
      title: t("safety.readinessLocation"),
      sub: permissionSub(readiness.foreground, t("safety.readinessLocationOn"), t("safety.readinessLocationOff")),
      ready: readiness.foreground === "granted",
      action: permissionAction(readiness.foreground, t("safety.actionAllow"), onFixForeground),
    },
    {
      key: "background",
      icon: "users",
      tone: "sky",
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
      tone: "mustard",
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
      tone: "stamp",
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
      tone: "mustard",
      title: t("safety.readinessBattery"),
      sub: readiness.batteryOptimized ? t("safety.readinessBatteryOff") : t("safety.readinessBatteryOn"),
      ready: !readiness.batteryOptimized,
      action: readiness.batteryOptimized
        ? { label: t("safety.actionOpenSettings"), onPress: onFixBattery }
        : undefined,
    });
  }

  const emergencyNumber = emergency?.general ?? "112";
  const emergencySub = emergency?.countryCode
    ? t("safety.readinessEmergencyCountry", {
        number: emergencyNumber,
        country: emergency.countryName ?? emergency.countryCode,
      })
    : t("safety.readinessEmergencyDefault", { number: emergencyNumber });

  return (
    <View>
      <View style={styles.sectionRow}>
        <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("safety.readinessTitle")}</Text>
        <View style={[styles.sectionLine, { backgroundColor: theme.hairline }]} />
        <Text
          style={[styles.summary, { color: ready === total ? theme.teal : theme.mustard }]}
          accessibilityLiveRegion="polite"
        >
          {t("safety.readinessSummary", { ready, total })}
        </Text>
      </View>
      <View style={styles.list}>
        {rows.map((row) => (
          <NomadCard key={row.key} theme={theme} style={styles.card}>
            <View style={[styles.icon, { backgroundColor: theme[`${row.tone}Soft`] }]}>
              <Icon name={row.icon} size={18} color={theme[row.tone]} strokeWidth={1.8} />
            </View>
            <View style={styles.body}>
              <Text style={[styles.title, { color: theme.inkDeep }]}>{row.title}</Text>
              <Text style={[styles.sub, { color: row.ready ? theme.inkSoft : theme.inkDeep }]}>{row.sub}</Text>
            </View>
            {row.ready || !row.action ? (
              <View
                style={[styles.check, { backgroundColor: theme.tealSoft }]}
                accessible
                accessibilityLabel={t("safety.readinessReadyA11y")}
              >
                <Icon name="check" size={14} color={theme.teal} strokeWidth={2.4} />
              </View>
            ) : (
              <Pressable
                onPress={row.action.onPress}
                accessibilityRole="button"
                accessibilityLabel={`${row.action.label}: ${row.title}`}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.action,
                  { backgroundColor: theme.inkDeep },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.actionText, { color: theme.paperSoft }]}>{row.action.label}</Text>
              </Pressable>
            )}
          </NomadCard>
        ))}

        <NomadCard theme={theme} style={styles.card}>
          <View style={[styles.icon, { backgroundColor: theme.stampSoft }]}>
            <Icon name="phone" size={18} color={theme.stamp} strokeWidth={1.8} />
          </View>
          <View style={styles.body}>
            <Text style={[styles.title, { color: theme.inkDeep }]}>{t("safety.readinessEmergency")}</Text>
            <Text style={[styles.sub, { color: theme.inkSoft }]}>{emergencySub}</Text>
          </View>
          <Pressable
            onPress={onCallEmergency}
            accessibilityRole="button"
            accessibilityLabel={t("sos.callEmergency", { number: emergencyNumber })}
            hitSlop={6}
            style={({ pressed }) => [styles.action, { backgroundColor: theme.stamp }, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.actionText, { color: "#fff" }]}>{t("safety.actionCall")}</Text>
          </Pressable>
        </NomadCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 6,
  },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  sectionLine: { flex: 1, height: 1 },
  summary: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11.5,
    fontWeight: "600",
  },
  list: { gap: 8, marginBottom: 14 },
  card: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  title: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
    fontWeight: "600",
  },
  sub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 1,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    minHeight: 34,
    justifyContent: "center",
  },
  actionText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 12.5,
    fontWeight: "600",
  },
});
