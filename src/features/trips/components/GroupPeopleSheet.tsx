import React, { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { api, type Id, useMutation } from "@/modules/backend";
import {
  AuraButton,
  AuraChip,
  AuraField,
  AuraListGroup,
  AuraListRow,
  AuraLoader,
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
import { isSettledUp, registerGroupPush, shareGroup } from "@/features/sync";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { payersOf } from "@/features/expenses/utils/split";
import { findMoneyGroup, isTrip, useTripsStore, type GroupMember, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { PrivateView } from "@/modules/analytics";

const [INDIGO, TEAL] = auraStatusColors.calm;

const MAX_NAME = 80;

/** Whether someone is named on any expense or payment of a trip or group (then they can't be removed locally). */
function isReferenced(groupId: string, person: string) {
  const { expenses, settlements } = useExpensesStore.getState();
  return (
    expenses.some((expense) => expense.groupId === groupId && (expense.shares?.some((share) => share.person === person) || payersOf(expense).some((payer) => payer.person === person))) ||
    settlements.some((settlement) => settlement.groupId === groupId && (settlement.from === person || settlement.to === person))
  );
}

/** People, invite link and settings for a trip or group; shares it first if needed. */
export function GroupPeopleSheet({ groupId, onClose, onDeleted }: { groupId: string | null; onClose: () => void; onDeleted?: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  // Sharing re-keys the trip or group, so follow it to its new id.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const id = currentId ?? groupId;
  const trip = useTripsStore((s) => findMoneyGroup(s, id));
  const [person, setPerson] = useState("");
  const k = (key: string) => (trip && !isTrip(trip) ? `groupShare.${key}` : `groupTrip.${key}`);
  const userName = useAuthStore((s) => s.user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const setPreferences = useMutation(api.groups.setPreferences);
  const leaveTrip = useMutation(api.groups.leaveGroup);
  const removeMember = useMutation(api.groups.removeMember);
  const resetInviteCode = useMutation(api.groups.resetInviteCode);
  const deleteSharedTrip = useMutation(api.groups.deleteSharedGroup);

  const close = () => {
    setCurrentId(null);
    setPerson("");
    onClose();
  };

  const setCompanions = (item: MoneyGroup, companions: string[]) => {
    if (isTrip(item)) useTripsStore.getState().updateTrip(item.id, { companions, mode: companions.length > 0 ? "group" : item.mode });
    else useTripsStore.getState().updateGroup(item.id, { companions });
  };

  const addPerson = () => {
    const name = person.trim().slice(0, MAX_NAME);
    if (!trip || !name) return;
    const taken = [...trip.companions, ...(trip.shared?.members.map((member) => member.name) ?? [])];
    if (!taken.some((existing) => existing.toLowerCase() === name.toLowerCase())) setCompanions(trip, [...trip.companions, name]);
    setPerson("");
  };

  const removePerson = (name: string) => {
    if (!trip) return;
    if (isReferenced(trip.id, name)) {
      showAlert(t("money.removePersonBlockedTitle", { name }), t("money.removePersonBlockedBody"));
      return;
    }
    setCompanions(trip, trip.companions.filter((existing) => existing !== name));
  };

  const deleteLocalGroup = () => {
    if (!trip || isTrip(trip)) return;
    showAlert(t("groupShare.deleteTitle"), t("groupShare.deleteBodyLocal"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("groupShare.deleteTrip"),
        style: "destructive",
        onPress: () => {
          const groupIdToDelete = trip.id;
          close();
          useExpensesStore.getState().removeByGroupId(groupIdToDelete);
          useChatStore.getState().removeConversation(groupIdToDelete);
          useTripsStore.getState().deleteGroup(groupIdToDelete);
          onDeleted?.();
        },
      },
    ]);
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
  const serverId = shared?.groupId as Id<"sharedGroups"> | undefined;
  const isOwner = shared?.role === "owner";
  const othersJoined = shared?.members.some((member) => member.linked && member.memberId !== shared.myMemberId && member.status === "active") ?? false;

  const startSharing = () =>
    trip &&
    run(async () => {
      setCurrentId(await shareGroup(trip, userName.split(" ")[0] || userName));
      void registerGroupPush(true);
    });

  const shareLink = () => {
    if (!trip || !shared?.inviteCode) return;
    const url = inviteUrl(shared.inviteCode);
    void Share.share({ message: t(k("inviteMessage"), { name: trip.name, url, code: shared.inviteCode }) });
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
      showAlert(t("groupTrip.leaveUnsettledTitle"), t(k("leaveUnsettledBody")));
      return;
    }
    confirm(t(k("leaveTitle")), t(k("leaveBody")), t(k("leave")), () => leaveTrip({ groupId: serverId }), close);
  };

  const onDelete = () => {
    if (!serverId) return;
    if (othersJoined) {
      showAlert(t(k("deleteTrip")), t(k("deleteBlocked")));
      return;
    }
    confirm(t(k("deleteTitle")), t(k("deleteBody")), t(k("deleteTrip")), () => deleteSharedTrip({ groupId: serverId }), close);
  };

  const memberDetail = (member: GroupMember) => {
    if (member.status === "left" || member.status === "removed") return t(k("left"));
    if (!member.linked) return t("groupTrip.notJoined");
    return member.role === "owner" ? t("groupTrip.owner") : undefined;
  };

  const footer = !trip ? null : !shared ? (
    <AuraButton label={t("groupTrip.createLink")} icon="users" onPress={startSharing} loading={busy} />
  ) : isOwner ? (
    <AuraButton label={t(k("deleteTrip"))} icon="trash" variant="secondary" onPress={onDelete} disabled={busy} />
  ) : (
    <AuraButton label={t(k("leave"))} icon="logout" variant="secondary" onPress={onLeave} disabled={busy} />
  );

  return (
    <AuraSheet
      visible={groupId !== null}
      onClose={close}
      title={shared ? t("groupTrip.peopleTitle") : t(k("shareTitle"))}
      subtitle={trip?.name}
      footer={footer}
    >
      <ScrollView contentContainerStyle={styles.body}>
        {trip && (!shared || (shared.myMemberId && shared.inviteCode)) ? (
          <PrivateView style={styles.people}>
            <AuraField
              label={t("money.addPerson")}
              value={person}
              onChangeText={setPerson}
              placeholder={t("money.personPlaceholder")}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={addPerson}
              blurOnSubmit={false}
            />
            {!shared && trip.companions.length > 0 ? (
              <View style={styles.chips}>
                {trip.companions.map((name) => (
                  <AuraChip key={name} label={name} icon="x" selected onPress={() => removePerson(name)} />
                ))}
              </View>
            ) : null}
          </PrivateView>
        ) : null}
        {!trip ? null : !shared ? (
          <>
            <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t(k("shareIntro"))}</Text>
            {!isTrip(trip) ? (
              <AuraButton label={t("groupShare.deleteTrip")} icon="trash" variant="ghost" size="md" onPress={deleteLocalGroup} style={styles.deleteLocal} />
            ) : null}
          </>
        ) : !shared.myMemberId || !shared.inviteCode ? (
          <View style={styles.pending}>
            <AuraLoader size={56} />
            <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t(k("settingUp"))}</Text>
          </View>
        ) : (
          <>
            <AuraListGroup title={t("groupTrip.inviteSection")} footer={t(k("inviteFooter"))}>
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
                    confirm(t("groupTrip.resetLinkTitle"), t(k("resetLinkBody")), t("groupTrip.resetLink"), () => resetInviteCode({ groupId: serverId! }))
                  }
                />
              ) : null}
            </AuraListGroup>

            <PrivateView>
            <AuraListGroup title={t(k("membersSection"))}>
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
                                t(k("removeBody")),
                                t("groupTrip.remove"),
                                () => removeMember({ groupId: serverId!, memberId: member.memberId }),
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
            </PrivateView>

            <AuraListGroup footer={t(k("notificationsSub"))}>
              <AuraListRow
                icon="bell"
                label={t("groupTrip.notifications")}
                trailing={
                  <AuraSwitch
                    value={!shared.muted}
                    onValueChange={(on) =>
                      void run(async () => {
                        if (on) await registerGroupPush(true);
                        await setPreferences({ groupId: serverId!, muted: !on });
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

/** Whether a trip or group is archived from this user's own list (shared ones only). */
export function isArchived(trip: Pick<MoneyGroup, "shared">) {
  return trip.shared?.archived === true;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 12 },
  intro: { fontSize: 15, lineHeight: 22, marginTop: 6 },
  pending: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  people: { gap: 10, marginBottom: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  deleteLocal: { alignSelf: "flex-start", marginTop: 14 },
});
