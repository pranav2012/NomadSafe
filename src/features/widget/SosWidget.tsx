import React from "react";
import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import { auraDark, auraLight, auraStatusAccent, type AuraPalette } from "@/constants/aura";
import { QUICK_SOS_URL } from "@/features/safety/store/quickSosStore";

export const SOS_WIDGET_NAME = "SosWidget";

export interface SosWidgetProps {
  labels: { title: string; hint: string };
  dark: boolean;
}

const ALERT = auraStatusAccent.alert as `#${string}`;

const shieldSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/><path d="M12 8v4M12 15.5v.5"/></svg>`;

/** Android home-screen SOS button: one tap opens the app's 5-second cancellable SOS countdown. */
export function SosWidget({ labels, dark }: SosWidgetProps) {
  const c = (dark ? auraDark : auraLight) as unknown as Record<keyof AuraPalette, `#${string}`>;

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: QUICK_SOS_URL }}
      accessibilityLabel={labels.title}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: c.card,
        borderRadius: 24,
        padding: 12,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexGap: 6,
      }}
    >
      <FlexWidget
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: ALERT,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SvgWidget svg={shieldSvg} style={{ height: 28, width: 28 }} />
      </FlexWidget>
      <TextWidget text={labels.title} style={{ fontSize: 15, color: c.text, fontWeight: "700" }} />
      <TextWidget text={labels.hint} maxLines={1} truncate="END" style={{ fontSize: 11, color: c.textMuted }} />
    </FlexWidget>
  );
}
