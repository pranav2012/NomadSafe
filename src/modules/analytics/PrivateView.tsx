import React from "react";
import type { ViewProps } from "react-native";
import { PostHogMaskView } from "posthog-react-native";

/** Hides its contents from session recordings (maps, money, personal details). */
export function PrivateView(props: ViewProps & { children: React.ReactNode }) {
  return <PostHogMaskView {...props} />;
}
