import { useEffect } from "react";
import { useRouter } from "expo-router";
import { translate } from "@/localization/translate";
import { notifications, useLastNotificationTap } from "@/modules/notifications";
import { SAFETY_NOTIFICATION_SOURCE, SOS_ROUTE } from "../services/checkInNotifications";
import { ensureSafetyAlertChannel } from "../services/safetyServerAlerts";

let handlerConfigured = false;

function configureHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  // Global handler: show every notification while foregrounded; safety ones also play sound.
  notifications.setForegroundHandler((data) => ({
    showBanner: true,
    showList: true,
    playSound: data?.source === SAFETY_NOTIFICATION_SOURCE,
    setBadge: false,
  }));
}

/**
 * Routes taps on check-in notifications and contacts' SOS alerts (including the one that
 * cold-started the app) to the SOS tab. Mount once inside the root navigator.
 */
export function useSafetyNotificationRouting() {
  const router = useRouter();
  const data = useLastNotificationTap();

  useEffect(() => {
    configureHandler();
    void ensureSafetyAlertChannel(translate("safety.alertChannelName"));
  }, []);

  useEffect(() => {
    if (!data) return;
    if (data.source !== SAFETY_NOTIFICATION_SOURCE || data.url !== SOS_ROUTE) return;
    router.navigate(SOS_ROUTE);
    notifications.clearLastTap();
  }, [data, router]);
}
