import React from "react";
import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SafetyScreen() {
  return (
    <Screen>
      <EmptyState
        icon="shield-outline"
        title="Safety Center"
        description="Set up emergency contacts and SOS alerts to stay safe while traveling."
      />
    </Screen>
  );
}
