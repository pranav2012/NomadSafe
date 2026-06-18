import React from "react";
import { Tabs } from "expo-router";
import { NomadTabBar } from "@/components/nomad/NomadTabBar";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}
      tabBar={(props) => <NomadTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Trip" }} />
      <Tabs.Screen name="sos" options={{ title: "Safety" }} />
      <Tabs.Screen name="sharing" options={{ title: "Share" }} />
      <Tabs.Screen name="expenses" options={{ title: "Money" }} />
      <Tabs.Screen name="ai" options={{ title: "AI" }} />
    </Tabs>
  );
}
