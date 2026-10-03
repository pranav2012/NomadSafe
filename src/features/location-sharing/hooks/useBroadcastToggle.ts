import { useCallback, useState } from "react";
import { Alert, Linking } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useLocalization } from "@/localization";
import { track } from "@/services/analytics";
import { heavyImpact, successNotification } from "@/utils/haptics";
import { hasAcceptedBackgroundDisclosure } from "../components/BackgroundLocationDisclosure";
import {
  BackgroundLocationDeniedError,
  isLocationBroadcastRunning,
  startLocationBroadcast,
  stopLocationBroadcast,
} from "../services/locationBroadcastTask";
import { useSharingStore, type BroadcastMode } from "../store/sharingStore";

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

  const begin = useCallback(async (nextMode: BroadcastMode = mode) => {
    setBusy(true);
    try {
      await startLocationBroadcast(nextMode);
      setBroadcasting(true);
      track("live_share_started", { mode: nextMode, recipients: activeRecipientCount });
      heavyImpact();
    } catch (err) {
      setBroadcasting(await isLocationBroadcastRunning());
      const background = err instanceof BackgroundLocationDeniedError;
      Alert.alert(t("sharing.permissionTitle"), background ? t("sharing.backgroundPermissionBody") : t("sharing.permissionBody"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("sharing.openSettings"), onPress: () => Linking.openSettings() },
      ]);
    } finally {
      setBusy(false);
    }
  }, [activeRecipientCount, mode, setBroadcasting, t]);

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
        Alert.alert(t("sharing.stopErrorTitle"), t("sharing.stopErrorBody"));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!hasAcceptedBackgroundDisclosure()) {
      setDisclosureVisible(true);
      return;
    }
    await begin();
  }, [begin, busy, isBroadcasting, setBroadcasting, t]);

  // Restarts a running broadcast so the new update interval takes effect.
  const changeMode = useCallback(async (next: BroadcastMode) => {
    if (next === mode || busy) return;
    setMode(next);
    if (isBroadcasting) await begin(next);
  }, [begin, busy, isBroadcasting, mode, setMode]);

  return {
    isBroadcasting,
    busy,
    mode,
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
