import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";

// TODO(milestone): build the trip money ledger. See design screens/expenses.jsx.
export default function ExpensesScreen() {
  return (
    <MilestoneStub
      eyebrow="Ledger"
      title="Trip"
      titleAccent="money"
      icon="wallet"
      designRef="screens/expenses.jsx"
      features={[
        "Spend chart over the last 14 days",
        "Categories: food / stays / travel / other",
        "Auto-logged entries parsed from email + SMS (on-device)",
        "Scan receipt to add an expense",
        "Group settle-up + multi-way split",
        "Recent transactions & top merchants",
      ]}
    />
  );
}
