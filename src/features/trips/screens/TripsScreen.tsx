import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";
import { useLocalization } from "@/localization";

// TODO(milestone): build the trip switcher + create-trip flow.
// See design screens/trips.jsx and app.jsx (TripSwitcherScreen / CreateTripScreen).
export default function TripsScreen() {
  const { t, tArray } = useLocalization();

  return (
    <MilestoneStub
      eyebrow={t("milestones.tripsEyebrow")}
      title={t("milestones.tripsTitle")}
      titleAccent={t("milestones.tripsAccent")}
      icon="compass"
      designRef="screens/trips.jsx"
      features={tArray("milestones.tripsFeatures")}
    />
  );
}
