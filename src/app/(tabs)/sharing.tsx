import React from "react";
import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SharingScreen() {
  return (
    <Screen>
      <EmptyState
        icon="people-outline"
        title="Live sharing"
        description="Share your live location and trip with trusted contacts."
      />
    </Screen>
  );
}
