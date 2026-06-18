import React from "react";
import { MilestoneStub } from "@/components/nomad/MilestoneStub";

// TODO(milestone): build the trip switcher + create-trip flow.
// See design screens/trips.jsx and app.jsx (TripSwitcherScreen / CreateTripScreen).
export default function TripsScreen() {
  return (
    <MilestoneStub
      eyebrow="Trips"
      title="Where"
      titleAccent="to next"
      icon="compass"
      designRef="screens/trips.jsx"
      features={[
        "Current trip card with day X/Y progress",
        "Switch between trips (current / upcoming / past)",
        "Create a trip: destination, dates, solo or group",
        "Invite companions to a group trip",
        "Past trips archived on-device",
      ]}
    />
  );
}
