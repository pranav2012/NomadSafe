import React from "react";
import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AiScreen() {
  return (
    <Screen>
      <EmptyState
        icon="sparkles-outline"
        title="On-device AI"
        description="Ask questions about your trips, budgets, and safety — all on-device."
      />
    </Screen>
  );
}
