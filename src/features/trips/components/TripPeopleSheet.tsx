import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { api, type Id, useMutation } from "@/modules/backend";
import {
  AuraButton,
  AuraListGroup,
  AuraListRow,
  AuraSheet,
  AuraSwitch,
  Icon,
  PressableScale,
  showAlert,
  useAura,
} from "@/atoms";
import { auraStatusColors } from "@/constants/aura";
import { inviteUrl } from "@/constants/legal";
import { useAuthStore } from "@/features/auth/store/authStore";
import { isSettledUp, registerTripPush, shareTrip } from "@/features/sync";
import { useTripsStore, type Trip, type TripMember } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";

const [INDIGO, TEAL] = auraStatusColors.calm;

/** Invite link, members and per-trip settings for a group trip; shares the trip first if needed. */
export function TripPeopleSheet({ tripId, onClose }: { tripId: string | null; onClose: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  // Sharing re-keys the trip, so follow it to its new id.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const id = currentId ?? tripId;
  const trip = useTripsStore((s) => s.trips.find((item) => item.id === id) ?? null);
  const userName = useAuthStore((s) => s.user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const setPreferences = useMutation(api.groupTrips.setPreferences);
  const leaveTrip = useMutation(api.groupTrips.leaveTrip);
  const removeMember = useMutation(api.groupTrips.removeMember);
  const resetInviteCode = useMutation(api.groupTrips.resetInviteCode);
  const deleteSharedTrip = useMutation(api.groupTrips.deleteSharedTrip);

  const close = () => {
    setCurrentId(null);
    onClose();
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      showAlert(t("groupTrip.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const shared = trip?.shared;
  const serverId = shared?.tripId as Id<"sharedTrips"> | undefined;
  const isOwner = shared?.role === "owner";
  const othersJoined = shared?.members.some((member) => member.linked && member.memberId !== shared.myMemberId && member.status === "active") ?? false;

  const startSharing = () =>
    trip &&
    run(async () => {
      setCurrentId(await shareTrip(trip, userName.split(" ")[0] || userName));
      void registerTripPush(true);
    });

  const shareLink = () => {
    if (!trip || !shared?.inviteCode) return;
    const url = inviteUrl(shared.inviteCode);
    void Share.share({ message: t("groupTrip.inviteMessage", { name: trip.name, url, code: shared.inviteCode }) });
  };

  const confirm = (title: string, body: string, label: string, action: () => Promise<unknown>, after?: () => void) =>
    showAlert(title, body, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: label,
        style: "destructive",
        onPress: () =>
          void run(async () => {
            await action();
            after?.();
          }),
      },
    ]);

  const onLeave = () => {
    if (!trip || !serverId) return;
    if (!isSettledUp(trip)) {
      showAlert(t("groupTrip.leaveUnsettledTitle"), t("groupTrip.leaveUnsettledBody"));
      return;
    }
    confirm(t("groupTrip.leaveTitle"), t("groupTrip.leaveBody"), t("groupTrip.leave"), () => leaveTrip({ tripId: serverId }), close);
  };

  const onDelete = () => {
    if (!serverId) return;
    if (othersJoined) {
      showAlert(t("groupTrip.deleteTrip"), t("groupTrip.deleteBlocked"));
      return;
    }
    confirm(t("groupTrip.deleteTitle"), t("groupTrip.deleteBody"), t("groupTrip.deleteTrip"), () => deleteSharedTrip({ tripId: serverId }), close);
  };

  const memberDetail = (member: TripMember) => {
    if (member.status === "left" || member.status === "removed") return t("groupTrip.left");
    if (!member.linked) return t("groupTrip.notJoined");
    return member.role === "owner" ? t("groupTrip.owner") : undefined;
  };

  const footer = !trip ? null : !shared ? (
    <AuraButton label={t("groupTrip.createLink")} icon="users" onPress={startSharing} loading={busy} />
  ) : isOwner ? (
    <AuraButton label={t("groupTrip.deleteTrip")} icon="trash" variant="secondary" onPress={onDelete} disabled={busy} />
  ) : (
    <AuraButton label={t("groupTrip.leave")} icon="logout" variant="secondary" onPress={onLeave} disabled={busy} />
  );

  return (
    <AuraSheet
      visible={tripId !== null}
      onClose={close}
      title={shared ? t("groupTrip.peopleTitle") : t("groupTrip.shareTitle")}
      subtitle={trip?.name}
      footer={footer}
    >
      <ScrollView contentContainerStyle={styles.body}>
        {!trip ? null : !shared ? (
          <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t("groupTrip.shareIntro")}</Text>
        ) : !shared.myMemberId || !shared.inviteCode ? (
          <View style={styles.pending}>
            <ActivityIndicator color={c.textMuted} />
            <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t("groupTrip.settingUp")}</Text>
          </View>
        ) : (
          <>
            <AuraListGroup title={t("groupTrip.inviteSection")} footer={t("groupTrip.inviteFooter")}>
              <AuraListRow
                icon="send"
                tone={TEAL}
                label={t("groupTrip.shareLink")}
                detail={t("groupTrip.inviteCode", { code: shared.inviteCode })}
                onPress={shareLink}
              />
              {isOwner ? (
                <AuraListRow
                  icon="swap"
                  label={t("groupTrip.resetLink")}
                  onPress={() =>
                    confirm(t("groupTrip.resetLinkTitle"), t("groupTrip.resetLinkBody"), t("groupTrip.resetLink"), () => resetInviteCode({ tripId: serverId! }))
                  }
                />
              ) : null}
            </AuraListGroup>

            <AuraListGroup title={t("groupTrip.membersSection")}>
              {shared.members
                .filter((member) => member.status === "active" || member.linked)
                .map((member) => {
                  const me = member.memberId === shared.myMemberId;
                  const removable = isOwner && !me && member.role !== "owner" && member.status === "active";
                  return (
                    <AuraListRow
                      key={member.memberId}
                      icon="users"
                      tone={member.linked ? INDIGO : undefined}
                      label={me ? t("groupTrip.you", { name: member.name }) : member.name}
                      detail={memberDetail(member)}
                      trailing={
                        removable ? (
                          <PressableScale
                            onPress={() =>
                              confirm(
                                t("groupTrip.removeTitle", { name: member.name }),
                                t("groupTrip.removeBody"),
                                t("groupTrip.remove"),
                                () => removeMember({ tripId: serverId!, memberId: member.memberId }),
                              )
                            }
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel={t("groupTrip.removeTitle", { name: member.name })}
                          >
                            <Icon name="x" size={16} color={c.textMuted} />
                          </PressableScale>
                        ) : undefined
                      }
                    />
                  );
                })}
            </AuraListGroup>

            <AuraListGroup footer={t("groupTrip.notificationsSub")}>
              <AuraListRow
                icon="bell"
                label={t("groupTrip.notifications")}
                trailing={
                  <AuraSwitch
                    value={!shared.muted}
                    onValueChange={(on) =>
                      void run(async () => {
                        if (on) await registerTripPush(true);
                        await setPreferences({ tripId: serverId!, muted: !on });
                      })
                    }
                    accessibilityLabel={t("groupTrip.notifications")}
                  />
                }
              />
            </AuraListGroup>
          </>
        )}
      </ScrollView>
    </AuraSheet>
  );
}

/** Whether a trip is archived from this user's own list (shared trips only). */
export function isArchived(trip: Trip) {
  return trip.shared?.archived === true;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 12 },
  intro: { fontSize: 15, lineHeight: 22, marginTop: 6 },
  pending: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
});
