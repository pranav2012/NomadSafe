import React from "react";
import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ExpensesScreen() {
  return (
    <Screen>
      <EmptyState
        icon="wallet-outline"
        title="No expenses yet"
        description="Track and split your travel expenses. They'll show up here."
      />
    </Screen>
  );
}
