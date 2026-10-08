import { useCallback, useState, type ReactNode } from "react";
import type { TabId } from "./data/demo";
import { AiScreen } from "./screens/AiScreen";
import { MoneyScreen } from "./screens/MoneyScreen";
import { SafetyScreen } from "./screens/SafetyScreen";
import { TripScreen } from "./screens/TripScreen";
import { TabBar } from "./TabBar";

export interface MiniAppProps {
  label: string;
  tab?: TabId;
  /** Trip tab opens on today's plan instead of the globe. */
  tripCompact?: boolean;
  globe?: boolean;
  /** Only the hero phone gets the tab bar; section phones stay on their one demo screen. */
  tabBar?: boolean;
}

function StatusBar() {
  return (
    <div className="mini-status" aria-hidden="true">
      <span>9:41</span>
      <span className="mini-status__icons">
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path d="M8.5 11.5 1 4a10.6 10.6 0 0 1 15 0z" fill="currentColor" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity="0.5" />
          <rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor" />
          <rect x="23.5" y="4" width="1.8" height="4" rx="0.9" fill="currentColor" opacity="0.5" />
        </svg>
      </span>
    </div>
  );
}

/** A small, client-only copy of the app's main tabs on demo data. */
export function MiniApp({ label, tab: initialTab = "trip", tripCompact = false, globe = false, tabBar = true }: MiniAppProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([initialTab]));
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => setAnnouncement(text), []);

  const go = (next: TabId) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
    announce(`${next === "ai" ? "AI" : next[0].toUpperCase() + next.slice(1)} tab`);
  };

  const screens: Record<TabId, ReactNode> = {
    trip: <TripScreen globe={globe} compact={tripCompact} announce={announce} active={tab === "trip"} />,
    safety: <SafetyScreen announce={announce} />,
    money: <MoneyScreen announce={announce} />,
    ai: <AiScreen />,
  };

  return (
    <div className={`mini${tabBar ? "" : " mini--single"}`} role="region" aria-roledescription="interactive demo" aria-label={label}>
      <StatusBar />
      {(Object.keys(screens) as TabId[]).map((id) =>
        visited.has(id) ? (
          <div key={id} className={`mini-screen${tab === id ? " is-active" : ""}`} hidden={tab !== id}>
            {screens[id]}
          </div>
        ) : null,
      )}
      {tabBar && <TabBar tab={tab} onChange={go} />}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
