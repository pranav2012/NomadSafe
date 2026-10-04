import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from "react-native";
import { AuraCard, AuraListGroup, AuraListRow, AuraSection, AuraSwitch, Icon, useAura } from "@/atoms";
import { auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { TrustedContactsEditor, type TrustedContactsSummary } from "@/features/settings/components/TrustedContactsEditor";
import { permissionsService, type PermissionStatus } from "@/features/onboarding/services/permissions";
import { useLocalization } from "@/localization";
import { StepHeader } from "./StepHeader";

type Translate = ReturnType<typeof useLocalization>["t"];

function permissionDetail(status: PermissionStatus | null, copy: { granted: string; ask: string; denied: string }, t: Translate) {
  if (status?.granted) return copy.granted;
  if (status && !status.canAskAgain) return t("onboarding.permissionDeniedSettings");
  if (status?.denied) return copy.denied;
  return copy.ask;
}

/** Asks, or opens Settings when the OS won't prompt again or the grant can only be revoked there. */
async function requestOrOpenSettings(status: PermissionStatus | null, request: () => Promise<PermissionStatus>, apply: (next: PermissionStatus) => void) {
  if (status?.granted || (status && !status.canAskAgain)) {
    Linking.openSettings().catch(() => {});
    return;
  }
  apply(await request());
}

/** Step 1: foreground location, check-in notifications, the SMS fallback and trusted contacts. */
export function SafetyStep({ onContactsChange }: { onContactsChange: (summary: TrustedContactsSummary) => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [location, setLocation] = useState<PermissionStatus | null>(null);
  const [notifications, setNotifications] = useState<PermissionStatus | null>(null);

  // Re-read on return from system Settings so the switches reflect the real grant.
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      permissionsService.checkAll().then((status) => {
        if (!mounted) return;
        setLocation(status.location);
        setNotifications(status.notifications);
      });
    void refresh();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const toggle = (status: PermissionStatus | null, label: string, request: () => Promise<PermissionStatus>, apply: (next: PermissionStatus) => void) =>
    status === null ? (
      <ActivityIndicator color={c.textMuted} />
    ) : (
      <AuraSwitch
        value={status.granted}
        accessibilityLabel={label}
        onValueChange={() => void requestOrOpenSettings(status, request, apply)}
      />
    );

  return (
    <View style={styles.root}>
      <StepHeader title={t("onboarding.safetyTitle")} lede={t("onboarding.safetyLede")} />

      <AuraListGroup footer={t("onboarding.locationBody")}>
        <AuraListRow
          icon="mapPin"
          tone={auraStatusColors.calm[0]}
          label={t("onboarding.locationWhileUsingLabel")}
          detail={permissionDetail(
            location,
            {
              granted: t("onboarding.locationGrantedSub"),
              ask: t("onboarding.locationAskSub"),
              denied: t("onboarding.locationDeniedSub"),
            },
            t,
          )}
          trailing={toggle(location, t("onboarding.locationWhileUsingLabel"), permissionsService.requestLocation, setLocation)}
        />
        <AuraListRow
          icon="bell"
          tone={auraStatusAccent.live}
          label={t("onboarding.checkInReminders")}
          detail={permissionDetail(
            notifications,
            {
              granted: t("onboarding.notificationsGrantedSub"),
              ask: t("onboarding.notificationsAskSub"),
              denied: t("onboarding.notificationsDeniedSub"),
            },
            t,
          )}
          trailing={toggle(notifications, t("onboarding.checkInReminders"), permissionsService.requestNotifications, setNotifications)}
        />
      </AuraListGroup>

      <AuraCard style={styles.smsCard}>
        <View style={styles.smsRow}>
          <View style={[styles.smsIcon, { backgroundColor: `${auraStatusColors.calm[1]}24` }]}>
            <Icon name="messageCircle" size={18} color={auraStatusColors.calm[1]} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.smsTitle, { color: c.text, fontFamily: f.semibold }]}>{t("onboarding.smsFallbackTitle")}</Text>
            <Text style={[styles.smsBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("onboarding.offlineBody")}</Text>
          </View>
        </View>
      </AuraCard>

      <AuraSection title={t("onboarding.trustedContactsTitle")} />
      <Text style={[styles.contactsLede, { color: c.textSoft, fontFamily: f.regular }]}>{t("onboarding.trustedContactsLede")}</Text>
      <TrustedContactsEditor onChange={onContactsChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingTop: 8 },
  flex: { flex: 1 },
  smsCard: { marginTop: 14 },
  smsRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  smsIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  smsTitle: { fontSize: 15.5 },
  smsBody: { fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  contactsLede: { fontSize: 14, lineHeight: 20, marginTop: -6, marginBottom: 4 },
});
