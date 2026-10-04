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
  readBroadcastState,
  startLocationBroadcast,
  stopLocationBroadcast,
} from "../services/locationBroadcastTask";
import { useSharingStore, type BroadcastMode } from "../store/sharingStore";
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
  const mode = useSharingStore((s) => s.mode);
  const setBroadcasting = useSharingStore((s) => s.setBroadcasting);
  const setMode = useSharingStore((s) => s.setMode);
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

  // A mode change restarts the task but keeps the share's original end time.
  const begin = useCallback(async (nextMode: BroadcastMode = mode, keepExpiry = false) => {
    setBusy(true);
    try {
      const expiresAt = keepExpiry
        ? readBroadcastState().expiresAt
        : shareDuration
          ? Date.now() + shareDuration
          : null;
      await startLocationBroadcast(nextMode, { expiresAt });
      setBroadcasting(true);
      track("live_share_started", { mode: nextMode, recipients: activeRecipientCount });
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
  }, [activeRecipientCount, mode, setBroadcasting, shareDuration, t]);

  const toggle = useCallback(async () => {
    if (busy) return;
    if (isBroadcasting) {
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
      return;
    }
    // Sharing with nobody would keep location running for no one; contactLinks is undefined while loading.
    if (contactLinks && activeRecipientCount === 0) {
      showAlert(t("sharing.noRecipientsTitle"), t("sharing.noRecipientsBody"));
      return;
    }
    if (!hasAcceptedBackgroundDisclosure()) {
      setDisclosureVisible(true);
      return;
    }
    await begin();
  }, [activeRecipientCount, begin, busy, contactLinks, isBroadcasting, setBroadcasting, t]);

  // Restarts a running broadcast so the new update interval takes effect.
  const changeMode = useCallback(async (next: BroadcastMode) => {
    if (next === mode || busy) return;
    setMode(next);
    if (isBroadcasting) await begin(next, true);
  }, [begin, busy, isBroadcasting, mode, setMode]);

  return {
    isBroadcasting,
    busy,
    mode,
    shareDuration,
    setShareDuration,
    activeRecipientCount,
    toggle,
    changeMode,
    disclosureVisible,
    onDisclosureAccept: () => {
      setDisclosureVisible(false);
      void begin();
    },
    onDisclosureDecline: () => setDisclosureVisible(false),
  };
}
