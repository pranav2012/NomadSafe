import React from "react";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { SOS_WIDGET_NAME, SosWidget } from "@/features/widget/SosWidget";
import { VoiceExpenseWidget } from "@/features/widget/VoiceExpenseWidget";
import { buildSosWidgetProps, buildWidgetProps } from "@/features/widget/widgetContent";

/** Headless Android widget renderer; runs in the app process, so it reads the encrypted stores directly. */
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === "WIDGET_DELETED") return;
  if (widgetInfo.widgetName === SOS_WIDGET_NAME) renderWidget(<SosWidget {...buildSosWidgetProps()} />);
  else renderWidget(<VoiceExpenseWidget {...buildWidgetProps()} />);
}
