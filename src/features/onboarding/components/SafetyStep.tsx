import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from "react-native";
import { AuraListGroup, AuraListRow, AuraSection, AuraSwitch, useAura } from "@/atoms";
import { auraStatusAccent, auraStatusColors } from "@/constants/aura";
import { AddPersonSheet } from "@/features/location-sharing/components/AddPersonSheet";
import { CircleAvatar } from "@/features/location-sharing/components/CircleAvatar";
import { useCircle } from "@/features/location-sharing/hooks/useCircle";
import { PrivateView } from "@/modules/analytics";
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

/** Step 1: foreground location, timer notifications, and the people to add to your circle. */
export function SafetyStep() {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [location, setLocation] = useState<PermissionStatus | null>(null);
  const [notifications, setNotifications] = useState<PermissionStatus | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const circle = useCircle();

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

      <AuraSection title={t("circle.title")} />
      <Text style={[styles.contactsLede, { color: c.textSoft, fontFamily: f.regular }]}>{t("onboarding.circleLede")}</Text>
      <PrivateView>
        <AuraListGroup>
          {circle.people.map((person) => (
            <AuraListRow
              key={person.key}
              label={person.name}
              detail={person.status === "accepted" ? t("circle.getsAlerts") : person.status === "invited" ? t("circle.invited") : t("circle.pending")}
              trailing={<CircleAvatar name={person.name} size={32} />}
            />
          ))}
          <AuraListRow icon="plus" tone={auraStatusColors.calm[1]} label={t("circle.addPerson")} onPress={() => setAddOpen(true)} />
        </AuraListGroup>
      </PrivateView>
      <AddPersonSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={circle.add}
        onShareLink={circle.shareInviteLink}
        onResetLink={circle.resetInviteLink}
        existingEmails={new Set(circle.people.map((p) => p.email ?? ""))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingTop: 8 },
  flex: { flex: 1 },
  contactsLede: { fontSize: 14, lineHeight: 20, marginTop: -6, marginBottom: 4 },
});
