// Background tasks must be defined before the router loads so Android can run
// them on a headless (no UI) launch.
import "@/features/location-sharing/services/locationBroadcastTask";
import "@/modules/ai/background";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "@/features/widget/widgetTaskHandler";
import "expo-router/entry";

registerWidgetTaskHandler(widgetTaskHandler);
