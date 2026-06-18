import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";
import { useLocalization } from "@/localization";

// TODO(milestone): build the on-device AI assistant. See design screens/ai.jsx.
export default function AiScreen() {
  const { t, tArray } = useLocalization();

  return (
    <MilestoneStub
      eyebrow={t("milestones.aiEyebrow")}
      title={t("milestones.aiTitle")}
      titleAccent={t("milestones.aiAccent")}
      icon="sparkle"
      designRef="screens/ai.jsx"
      features={tArray("milestones.aiFeatures")}
    />
  );
}
