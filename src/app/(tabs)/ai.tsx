import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";

// TODO(milestone): build the on-device AI assistant. See design screens/ai.jsx.
export default function AiScreen() {
  return (
    <MilestoneStub
      eyebrow="On-device AI"
      title="A tiny brain for"
      titleAccent="your money"
      icon="sparkle"
      designRef="screens/ai.jsx"
      features={[
        "Daily spend trend (last 7 days) + category breakdown",
        "Avg/day, streaks, by-day and top-merchant stats",
        "On-device budget forecast (e.g. projected surplus)",
        "Suggested prompts: overspend, forecast, biggest category",
        "Chat answers computed locally — 0 bytes leave the device",
      ]}
    />
  );
}
