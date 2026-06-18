import React from "react";
import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function TripsScreen() {
  return (
    <Screen>
      <EmptyState
        icon="airplane-outline"
        title="No trips yet"
        description="Plan and track your travels. Your trips will appear here."
      />
    </Screen>
  );
}
