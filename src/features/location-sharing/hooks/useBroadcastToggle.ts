import { useCallback, useState } from "react";
import { Linking } from "react-native";
import { api, useQuery } from "@/modules/backend";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { heavyImpact, successNotification } from "@/utils/haptics";
import { hasAcceptedBackgroundDisclosure } from "../components/BackgroundLocationDisclosure";
import {
  BackgroundLocationDeniedError,
  isLocationBroadcastRunning,
  startLocationBroadcast,
  stopLocationBroadcast,
} from "../services/locationBroadcastTask";
import { useSharingStore } from "../store/sharingStore";
import { showAlert } from "@/atoms";

/**
 * Start/stop live location sharing from anywhere, with the same rules everywhere: the
 * background-location disclosure is shown before the first start (Play policy), permission
 * failures explain how to fix them, and the store is re-synced with the real OS task on error.
 * Render `BackgroundLocationDisclosure` with `disclosureVisible`, `onDisclosureAccept` and
 * `onDisclosureDecline`.
 */
export function useBroadcastToggle() {
  const { t } = useLocalization();
  const isBroadcasting = useSharingStore((s) => s.isBroadcasting);
  const setBroadcasting = useSharingStore((s) => s.setBroadcasting);
  const shareDuration = useSharingStore((s) => s.shareDuration);
  const setShareDuration = useSharingStore((s) => s.setShareDuration);
  const [busy, setBusy] = useState(false);
  const [disclosureVisible, setDisclosureVisible] = useState(false);

  const contactLinks = useQuery(api.sharing.getContactLinks) as
    | { outgoing: { linkedUserId: string; status: string }[] }
    | undefined;
  const outgoingShares = useQuery(api.sharing.getOutgoingShares) as { recipientUserId: string; paused: boolean }[] | undefined;
  const paused = new Set((outgoingShares ?? []).filter((s) => s.paused).map((s) => s.recipientUserId));
  const activeRecipientCount = (contactLinks?.outgoing ?? []).filter(
    (link) => link.status === "accepted" && !paused.has(link.linkedUserId),
  ).length;

  // Normal mode; the task drops to low power on its own when the battery runs low.
  const begin = useCallback(async () => {
    setBusy(true);
    try {
      await startLocationBroadcast("normal", { expiresAt: shareDuration ? Date.now() + shareDuration : null });
      setBroadcasting(true);
      track("live_share_started", { mode: "normal", recipients: activeRecipientCount });
      heavyImpact();
    } catch (err) {
      setBroadcasting(await isLocationBroadcastRunning());
      const background = err instanceof BackgroundLocationDeniedError;
      showAlert(t("sharing.permissionTitle"), background ? t("sharing.backgroundPermissionBody") : t("sharing.permissionBody"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("sharing.openSettings"), onPress: () => Linking.openSettings() },
      ]);
    } finally {
      setBusy(false);
    }
  }, [activeRecipientCount, setBroadcasting, shareDuration, t]);

  const stop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopLocationBroadcast();
      setBroadcasting(false);
      track("live_share_stopped");
      successNotification();
    } catch {
      setBroadcasting(await isLocationBroadcastRunning());
      showAlert(t("sharing.stopErrorTitle"), t("sharing.stopErrorBody"));
    } finally {
      setBusy(false);
    }
  }, [busy, setBroadcasting, t]);

  // Pass the recipient count when the caller just changed who sees you, before the query catches up.
  const start = useCallback(async (recipients = activeRecipientCount) => {
    if (busy || isBroadcasting) return;
    // Sharing with nobody would keep location running for no one; contactLinks is undefined while loading.
    if (contactLinks && recipients === 0) {
      showAlert(t("sharing.noRecipientsTitle"), t("sharing.noRecipientsBody"));
      return;
    }
    if (!hasAcceptedBackgroundDisclosure()) {
      setDisclosureVisible(true);
      return;
    }
    await begin();
  }, [activeRecipientCount, begin, busy, contactLinks, isBroadcasting, t]);

  const toggle = useCallback(() => (isBroadcasting ? stop() : start()), [isBroadcasting, start, stop]);

  return {
    isBroadcasting,
    busy,
    shareDuration,
    setShareDuration,
    activeRecipientCount,
    toggle,
    start,
    stop,
    disclosureVisible,
    onDisclosureAccept: () => {
      setDisclosureVisible(false);
      void begin();
    },
    onDisclosureDecline: () => setDisclosureVisible(false),
  };
}
