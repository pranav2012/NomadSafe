import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";
import { useLocalization } from "@/localization";

// TODO(milestone): build the trip money ledger. See design screens/expenses.jsx.
export default function ExpensesScreen() {
  const { t, tArray } = useLocalization();

  return (
    <MilestoneStub
      eyebrow={t("milestones.expensesEyebrow")}
      title={t("milestones.expensesTitle")}
      titleAccent={t("milestones.expensesAccent")}
      icon="wallet"
      designRef="screens/expenses.jsx"
      features={tArray("milestones.expensesFeatures")}
    />
  );
}
