import { Appearance } from "react-native";
import { translate } from "@/localization/translate";
import { useSettingsStore } from "@/features/settings";
import { resolveWidgetTrip } from "@/features/widget/widgetTrip";
import { getWidgetToken } from "@/features/widget/widgetToken";
import type { SosWidgetProps } from "@/features/widget/SosWidget";
import type { VoiceExpenseWidgetProps } from "@/features/widget/VoiceExpenseWidget";

export function buildWidgetProps(): VoiceExpenseWidgetProps {
  const trip = resolveWidgetTrip();
  return {
    tripId: trip?.id ?? null,
    tripName: trip?.name ?? translate("voiceExpense.widget.noTrip"),
    labels: {
      eyebrow: translate("voiceExpense.widget.eyebrow"),
      speak: translate("voiceExpense.widget.speak"),
      change: translate("voiceExpense.widget.changeTrip"),
    },
    dark: isWidgetDark(),
    token: getWidgetToken(),
  };
}

export function buildSosWidgetProps(): SosWidgetProps {
  return {
    labels: { title: translate("sos.widget.title"), hint: translate("sos.widget.hint") },
    dark: isWidgetDark(),
    token: getWidgetToken(),
  };
}

/** Follows the app's theme setting; "system" falls back to the phone (headless launches have no override). */
function isWidgetDark(): boolean {
  const mode = useSettingsStore.getState().themeMode;
  return (mode === "system" ? Appearance.getColorScheme() : mode) === "dark";
}
