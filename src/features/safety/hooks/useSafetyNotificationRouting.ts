import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { translate } from "@/localization/translate";
import { SAFETY_NOTIFICATION_SOURCE, SOS_ROUTE } from "../services/checkInNotifications";
import { ensureSafetyAlertChannel } from "../services/safetyServerAlerts";

let handlerConfigured = false;

function configureHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  // Global handler: show every notification while foregrounded; safety ones also play sound.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isSafety = notification.request.content.data?.source === SAFETY_NOTIFICATION_SOURCE;
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: isSafety,
        shouldSetBadge: false,
      };
    },
  });
}

/**
 * Routes taps on check-in notifications and contacts' SOS alerts (including the one that
 * cold-started the app) to the SOS tab. Mount once inside the root navigator.
 */
export function useSafetyNotificationRouting() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    configureHandler();
    void ensureSafetyAlertChannel(translate("safety.alertChannelName"));
  }, []);

  useEffect(() => {
    if (!response) return;
    const data = response.notification.request.content.data;
    if (data?.source !== SAFETY_NOTIFICATION_SOURCE || data?.url !== SOS_ROUTE) return;
    router.navigate(SOS_ROUTE);
    Notifications.clearLastNotificationResponse();
  }, [response, router]);
}
