import React from "react";
import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import { ExtensionStorage } from "@bacons/apple-targets";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { translate } from "@/localization/translate";
import { logger } from "@/modules/logger";
import { VOICE_WIDGET_NAME, VoiceExpenseWidget } from "@/features/widget/VoiceExpenseWidget";
import { SOS_WIDGET_NAME, SosWidget } from "@/features/widget/SosWidget";
import { buildSosWidgetProps, buildWidgetProps } from "@/features/widget/widgetContent";
import { resolveWidgetTrip } from "@/features/widget/widgetTrip";

export const APP_GROUP = "group.com.pranav.NomadSafe";
const IOS_WIDGET_KIND = "VoiceExpenseWidget";
const IOS_SOS_WIDGET_KIND = "SosWidget";

/**
 * Pushes trip names and labels to the home-screen widgets (voice expense and SOS). iOS reads
 * them from the App Group (plain UserDefaults), so only ids, names and UI labels are shared.
 */
export async function syncWidgets() {
  try {
    if (Platform.OS === "android") {
      await requestWidgetUpdate({
        widgetName: VOICE_WIDGET_NAME,
        renderWidget: () => React.createElement(VoiceExpenseWidget, buildWidgetProps()),
        widgetNotFound: () => {},
      });
      await requestWidgetUpdate({
        widgetName: SOS_WIDGET_NAME,
        renderWidget: () => React.createElement(SosWidget, buildSosWidgetProps()),
        widgetNotFound: () => {},
      });
    } else if (Platform.OS === "ios") {
      const { trips } = useTripsStore.getState();
      const shared = new ExtensionStorage(APP_GROUP);
      shared.set("trips", JSON.stringify(trips.map((trip) => ({ id: trip.id, name: trip.name }))));
      shared.set("defaultTripId", resolveWidgetTrip()?.id ?? undefined);
      shared.set(
        "labels",
        JSON.stringify({
          eyebrow: translate("voiceExpense.widget.eyebrow"),
          speak: translate("voiceExpense.widget.speak"),
          noTrip: translate("voiceExpense.widget.noTrip"),
          defaultTrip: translate("voiceExpense.widget.defaultTrip"),
        }),
      );
      shared.set("sosLabels", JSON.stringify({ title: translate("sos.widget.title"), hint: translate("sos.widget.hint") }));
      ExtensionStorage.reloadWidget(IOS_WIDGET_KIND);
      ExtensionStorage.reloadWidget(IOS_SOS_WIDGET_KIND);
    }
  } catch (error) {
    logger.warn("widgets", "widget sync failed", error);
  }
}
