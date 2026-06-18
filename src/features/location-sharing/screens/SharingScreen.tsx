import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";
import { useLocalization } from "@/localization";

// TODO(milestone): build live location sharing. See design screens/sharing.jsx.
export default function SharingScreen() {
  const { t, tArray } = useLocalization();

  return (
    <MilestoneStub
      eyebrow={t("milestones.sharingEyebrow")}
      title={t("milestones.sharingTitle")}
      titleAccent={t("milestones.sharingAccent")}
      icon="users"
      designRef="screens/sharing.jsx"
      features={tArray("milestones.sharingFeatures")}
    />
  );
}
