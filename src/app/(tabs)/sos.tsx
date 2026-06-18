import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";
import { useLocalization } from "@/localization";

// TODO(milestone): build the Safety center. See design screens/sos.jsx.
export default function SosScreen() {
  const { t, tArray } = useLocalization();

  return (
    <MilestoneStub
      eyebrow={t("milestones.safetyEyebrow")}
      title={t("milestones.safetyTitle")}
      titleAccent={t("milestones.safetyAccent")}
      icon="shield"
      designRef="screens/sos.jsx"
      features={tArray("milestones.safetyFeatures")}
    />
  );
}
