import React from "react";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { VoiceExpenseWidget } from "@/features/widget/VoiceExpenseWidget";
import { buildWidgetProps } from "@/features/widget/widgetContent";

/** Headless Android widget renderer; runs in the app process, so it reads the encrypted stores directly. */
export async function widgetTaskHandler({ widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === "WIDGET_DELETED") return;
  renderWidget(<VoiceExpenseWidget {...buildWidgetProps()} />);
}
