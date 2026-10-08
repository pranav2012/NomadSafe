import { useState } from "react";
import { useRouter } from "expo-router";
import { showAlert, type IconName } from "@/atoms";
import { api, type Id, useMutation } from "@/modules/backend";
import { useLocalization } from "@/localization";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useRecurringStore } from "@/features/expenses/store/recurringStore";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";
import { isSettledUp } from "@/features/sync";
import { isTrip, useTripsStore, type MoneyGroup } from "@/features/trips/store/tripsStore";

/** Leave or delete a trip or group; a trip on this phone is deleted from Trips (with everything attached). */
export function useRemoveGroup(group: MoneyGroup | null, onDone: () => void) {
  const { t } = useLocalization();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const leave = useMutation(api.groups.leaveGroup);
  const deleteShared = useMutation(api.groups.deleteSharedGroup);
  const k = (key: string) => (group && !isTrip(group) ? `groupShare.${key}` : `groupTrip.${key}`);

  const confirm = (title: string, body: string, label: string, action: () => Promise<unknown> | void) =>
    showAlert(title, body, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: label,
        style: "destructive",
        onPress: () => {
          setBusy(true);
          Promise.resolve(action())
            .then(onDone)
            .catch(() => showAlert(t("groupTrip.actionFailed")))
            .finally(() => setBusy(false));
        },
      },
    ]);

  if (!group) return null;
  const shared = group.shared;
  const othersJoined = shared?.members.some((member) => member.linked && member.memberId !== shared.myMemberId && member.status === "active") ?? false;
  const forgetLocally = (id: string) => {
    useExpensesStore.getState().removeByGroupId(id);
    useChatStore.getState().removeConversation(id);
    useRecurringStore.getState().removeByGroupId(id);
    usePocketsStore.getState().removeByGroupId(id);
  };

  let label: string;
  let icon: IconName = "trash";
  let run: () => void;
  if (shared && shared.role !== "owner") {
    label = t(k("leave"));
    icon = "logout";
    run = () => {
      if (!isSettledUp(group)) {
        showAlert(t("groupTrip.leaveUnsettledTitle"), t(k("leaveUnsettledBody")));
        return;
      }
      confirm(t(k("leaveTitle")), t(k("leaveBody")), t(k("leave")), () => leave({ groupId: shared.groupId as Id<"sharedGroups"> }));
    };
  } else if (shared) {
    label = t(k("deleteTrip"));
    run = () => {
      if (othersJoined) {
        showAlert(t(k("deleteTrip")), t(k("deleteBlocked")));
        return;
      }
      confirm(t(k("deleteTitle")), t(k("deleteBody")), t(k("deleteTrip")), () => deleteShared({ groupId: shared.groupId as Id<"sharedGroups"> }));
    };
  } else if (!isTrip(group)) {
    label = t("groupShare.deleteTrip");
    run = () =>
      confirm(t("groupShare.deleteTitle"), t("groupShare.deleteBodyLocal"), t("groupShare.deleteTrip"), () => {
        forgetLocally(group.id);
        useTripsStore.getState().deleteGroup(group.id);
      });
  } else {
    label = t("groupSettings.deleteInTrips");
    run = () => {
      onDone();
      router.push("/trips");
    };
  }
  return { label, icon, busy, run };
}
