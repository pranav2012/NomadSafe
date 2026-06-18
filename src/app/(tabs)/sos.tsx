import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";

// TODO(milestone): build the Safety center. See design screens/sos.jsx.
export default function SosScreen() {
  return (
    <MilestoneStub
      eyebrow="Safety"
      title="Peace of mind"
      titleAccent="engine"
      icon="shield"
      designRef="screens/sos.jsx"
      features={[
        "Safety status: idle / active / emergency states",
        "Check-in countdown timer with extend & custom durations",
        "Big SOS trigger that broadcasts to the trusted three",
        "Geofence arrival/exit alerts",
        "Live sensors panel + safety score",
        "Recent activity log (last 7 days)",
      ]}
    />
  );
}
