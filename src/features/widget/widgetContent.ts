import { Appearance } from "react-native";
import { translate } from "@/localization/translate";
import { resolveWidgetTrip } from "@/features/widget/widgetTrip";
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
    dark: Appearance.getColorScheme() === "dark",
  };
}
