import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";

// TODO(milestone): build live location sharing. See design screens/sharing.jsx.
export default function SharingScreen() {
  return (
    <MilestoneStub
      eyebrow="Sharing"
      title="Who can"
      titleAccent="see you"
      icon="users"
      designRef="screens/sharing.jsx"
      features={[
        "Live broadcasting toggle with current location label",
        "Update strategy: normal / low-power / max accuracy",
        "Projected battery drain over 24h",
        "Shared-with list (distance + since when)",
        "Auto-notify geofences",
        "End-to-end encrypted share links with expiry",
      ]}
    />
  );
}
