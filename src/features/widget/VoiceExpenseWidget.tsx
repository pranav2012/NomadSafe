import React from "react";
import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import { nomadDarkColors, nomadLightColors } from "@/constants/theme";
import { voiceCaptureUrl } from "@/features/widget/widgetTrip";

export const VOICE_WIDGET_NAME = "VoiceExpenseWidget";

export interface VoiceExpenseWidgetProps {
  tripId: string | null;
  tripName: string;
  labels: { eyebrow: string; speak: string; change: string };
  dark: boolean;
}

const micSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>`;

/** Android home-screen widget (RemoteViews): trip row opens the picker, Speak starts listening. */
export function VoiceExpenseWidget({ tripId, tripName, labels, dark }: VoiceExpenseWidgetProps) {
  const colors = dark ? nomadDarkColors : nomadLightColors;
  const background = dark ? "#1F2529" : "#FBF6EC";

  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: background,
        borderRadius: 22,
        padding: 14,
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: voiceCaptureUrl({ tripId, pickTrip: true }) }}
        accessibilityLabel={labels.change}
        style={{ width: "match_parent", flexDirection: "column" }}
      >
        <TextWidget
          text={labels.eyebrow.toUpperCase()}
          style={{ fontSize: 10, color: colors.inkMuted, fontWeight: "700", letterSpacing: 0.12 }}
        />
        <FlexWidget style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
          <TextWidget
            text={tripName}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 16, color: colors.inkDeep, fontWeight: "600" }}
          />
          <TextWidget text="  ▾" style={{ fontSize: 14, color: colors.inkSoft }} />
        </FlexWidget>
      </FlexWidget>

      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: voiceCaptureUrl({ tripId, autostart: true }) }}
        accessibilityLabel={labels.speak}
        style={{
          width: "match_parent",
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.teal,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          flexGap: 8,
        }}
      >
        <SvgWidget svg={micSvg("#FFFFFF")} style={{ height: 20, width: 20 }} />
        <TextWidget text={labels.speak} style={{ fontSize: 15, color: "#FFFFFF", fontWeight: "600" }} />
      </FlexWidget>
    </FlexWidget>
  );
}
