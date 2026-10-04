import React from "react";
import { Linking, Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { AuraListGroup, AuraListRow, AuraSheet } from "@/atoms";
import { buildMapsUrl } from "@/features/safety/services/sosService";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { successNotification } from "@/utils/haptics";

interface LocationActionsSheetProps {
  visible: boolean;
  location: { latitude: number; longitude: number } | null;
  onClose: () => void;
}

/** Share, copy or open the current coordinates in a maps app. */
export function LocationActionsSheet({ visible, location, onClose }: LocationActionsSheetProps) {
  const { t } = useLocalization();
  const coords = location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "";
  const url = location ? buildMapsUrl(location) : "";

  const handleShare = () => {
    track("location_coords_action", { action: "share" });
    onClose();
    // iOS shares the URL as a link; Android only reads the message.
    Share.share(Platform.OS === "ios" ? { message: coords, url } : { message: `${coords}\n${url}` }).catch(() => {});
  };

  const handleCopy = () => {
    track("location_coords_action", { action: "copy" });
    onClose();
    void Clipboard.setStringAsync(coords).then(() => successNotification());
  };

  const handleOpenMaps = () => {
    track("location_coords_action", { action: "maps" });
    onClose();
    Linking.openURL(url).catch(() => {});
  };

  return (
    <AuraSheet visible={visible && location !== null} onClose={onClose} title={t("safety.coordsTitle")} subtitle={coords}>
      <AuraListGroup>
        <AuraListRow icon="share" label={t("safety.coordsShare")} detail={t("safety.coordsShareDetail")} onPress={handleShare} />
        <AuraListRow icon="copy" label={t("safety.coordsCopy")} onPress={handleCopy} />
        <AuraListRow icon="mapPin" label={t("safety.coordsOpenMaps")} onPress={handleOpenMaps} />
      </AuraListGroup>
    </AuraSheet>
  );
}
