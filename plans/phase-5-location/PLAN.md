# Phase 5: Real-time Location Sharing

## Overview

This phase adds battery-optimized real-time location sharing with family/trusted contacts. Users start a sharing session, select contacts, and their location is broadcast in real-time via Convex. Recipients with the app see live location on a map. Adaptive update intervals based on movement speed minimize battery drain.

## Dependencies

- Phase 1 (design system, auth, Convex, storage)
- Phase 4 (expo-location, expo-task-manager, background location infrastructure)

---

## Step 1: Install Packages

```bash
pnpm add react-native-maps
```

`expo-location`, `expo-task-manager` already installed in Phase 4.

### app.json — Google Maps API Key (Android)

```json
{
  "android": {
    "config": {
      "googleMaps": {
        "apiKey": "YOUR_GOOGLE_MAPS_API_KEY"
      }
    }
  }
}
```

iOS uses Apple Maps by default (no key needed). Google Maps on iOS requires the API key in a config plugin.

---

## Step 2: TypeScript Types

### types/location.ts

```typescript
import type { Id } from "@/convex/_generated/dataModel";

export type ShareSessionStatus = "active" | "paused" | "ended";

export interface LocationPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  speed: number | null;           // m/s
  heading: number | null;         // degrees
  timestamp: number;
  batteryLevel: number | null;    // 0-1
}

export interface LocationSession {
  _id: Id<"locationSessions">;
  userId: Id<"users">;
  name: string;                    // e.g., "Trip to Tokyo"
  status: ShareSessionStatus;
  sharedWithUserIds: Id<"users">[];
  updateIntervalMs: number;
  startedAt: number;
  pausedAt?: number;
  endedAt?: number;
}

export interface SharedUserLocation {
  userId: Id<"users">;
  userName: string;
  avatarUrl?: string;
  latestPoint: LocationPoint;
  sessionId: Id<"locationSessions">;
  isStale: boolean;                // true if last update > 10 min ago
}

export interface ShareConfig {
  maxLocalHistoryPoints: number;   // default 1000
  stationaryIntervalMs: number;    // 300000 (5 min)
  walkingIntervalMs: number;       // 30000 (30s)
  drivingIntervalMs: number;       // 10000 (10s)
  speedThresholds: {
    stationary: number;            // < 0.5 m/s
    walking: number;               // < 5 m/s
    // >= walking threshold = driving
  };
}

export const DEFAULT_SHARE_CONFIG: ShareConfig = {
  maxLocalHistoryPoints: 1000,
  stationaryIntervalMs: 300000,
  walkingIntervalMs: 30000,
  drivingIntervalMs: 10000,
  speedThresholds: {
    stationary: 0.5,
    walking: 5.0,
  },
};
```

---

## Step 3: Convex Schema

### convex/schema.ts (MODIFY)

```typescript
locationSessions: defineTable({
  userId: v.id("users"),
  name: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("ended")
  ),
  sharedWithUserIds: v.array(v.id("users")),
  updateIntervalMs: v.number(),
  startedAt: v.number(),
  pausedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_status", ["status"]),

locationPoints: defineTable({
  sessionId: v.id("locationSessions"),
  userId: v.id("users"),
  latitude: v.number(),
  longitude: v.number(),
  altitude: v.optional(v.number()),
  accuracy: v.number(),
  speed: v.optional(v.number()),
  heading: v.optional(v.number()),
  batteryLevel: v.optional(v.number()),
  timestamp: v.number(),
})
  .index("by_session", ["sessionId"])
  .index("by_session_timestamp", ["sessionId", "timestamp"])
  .index("by_user_recent", ["userId", "timestamp"]),
```

---

## Step 4: Convex Functions

### convex/location.ts

**Queries:**
```typescript
// getActiveSessions — get all active location sessions for current user (own + shared with)
export const getActiveSessions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    // Own sessions
    const ownSessions = await ctx.db
      .query("locationSessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.neq(q.field("status"), "ended"))
      .collect();

    // Sessions shared with user
    const allActiveSessions = await ctx.db
      .query("locationSessions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const sharedSessions = allActiveSessions.filter((s) =>
      s.sharedWithUserIds.includes(user._id)
    );

    return { ownSessions, sharedSessions };
  },
});

// getSessionLocations — get location points for a session (last N points)
export const getSessionLocations = query({
  args: {
    sessionId: v.id("locationSessions"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sessionId, limit }) => {
    const points = await ctx.db
      .query("locationPoints")
      .withIndex("by_session_timestamp", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(limit ?? 100);

    return points.reverse(); // chronological order
  },
});

// getLatestLocations — get latest location per user for shared sessions
export const getLatestLocations = query({
  args: { sessionIds: v.array(v.id("locationSessions")) },
  handler: async (ctx, { sessionIds }) => {
    // For each session, get the most recent location point
    // Return with user info for map display
  },
});
```

**Mutations:**
```typescript
// createSession — start a new location sharing session
export const createSession = mutation({
  args: {
    name: v.string(),
    sharedWithUserIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

    return await ctx.db.insert("locationSessions", {
      userId: user._id,
      name: args.name,
      status: "active",
      sharedWithUserIds: args.sharedWithUserIds,
      updateIntervalMs: DEFAULT_SHARE_CONFIG.walkingIntervalMs,
      startedAt: Date.now(),
    });
  },
});

// updateLocation — add a new location point (debounced from client)
export const updateLocation = mutation({
  args: {
    sessionId: v.id("locationSessions"),
    latitude: v.number(),
    longitude: v.number(),
    altitude: v.optional(v.number()),
    accuracy: v.number(),
    speed: v.optional(v.number()),
    heading: v.optional(v.number()),
    batteryLevel: v.optional(v.number()),
    timestamp: v.number(),
  },
  handler: async (ctx, { sessionId, ...point }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.status !== "active") return;

    await ctx.db.insert("locationPoints", {
      sessionId,
      userId: session.userId,
      ...point,
    });

    // Prune old points: keep last 500 per session
    const allPoints = await ctx.db
      .query("locationPoints")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();

    if (allPoints.length > 500) {
      const toDelete = allPoints.slice(0, allPoints.length - 500);
      for (const point of toDelete) {
        await ctx.db.delete(point._id);
      }
    }
  },
});

// pauseSession, resumeSession, endSession — lifecycle mutations
export const pauseSession = mutation({ ... });
export const resumeSession = mutation({ ... });
export const endSession = mutation({ ... });
```

---

## Step 5: Location Sharing Service

### services/locationSharing.ts

```typescript
import * as Location from 'expo-location';
import * as Battery from 'expo-battery'; // may need to install if not available
import { DEFAULT_SHARE_CONFIG, type ShareConfig, type LocationPoint } from '@/types/location';

/**
 * Determines update interval based on current speed.
 */
export function getAdaptiveInterval(
  speed: number | null,
  config: ShareConfig = DEFAULT_SHARE_CONFIG
): number {
  if (speed === null || speed < config.speedThresholds.stationary) {
    return config.stationaryIntervalMs;
  }
  if (speed < config.speedThresholds.walking) {
    return config.walkingIntervalMs;
  }
  return config.drivingIntervalMs;
}

/**
 * Creates a location point from expo-location data.
 */
export async function createLocationPoint(
  location: Location.LocationObject
): Promise<LocationPoint> {
  let batteryLevel: number | null = null;
  try {
    batteryLevel = await Battery.getBatteryLevelAsync();
  } catch { /* Battery API may not be available */ }

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    altitude: location.coords.altitude,
    accuracy: location.coords.accuracy ?? 0,
    speed: location.coords.speed,
    heading: location.coords.heading,
    timestamp: location.timestamp,
    batteryLevel,
  };
}
```

### services/locationHistory.ts

```typescript
import { storage } from '@/stores/storage';
import type { LocationPoint } from '@/types/location';

const HISTORY_KEY = (sessionId: string) => `location-history-${sessionId}`;

/**
 * Ring buffer: stores location points locally in MMKV.
 * When points exceed max, oldest are removed.
 */
export const locationHistory = {
  getPoints(sessionId: string): LocationPoint[] {
    const raw = storage.getString(HISTORY_KEY(sessionId));
    return raw ? JSON.parse(raw) : [];
  },

  addPoint(sessionId: string, point: LocationPoint, maxPoints = 1000): void {
    const points = this.getPoints(sessionId);
    points.push(point);

    // Ring buffer: remove oldest if exceeds max
    if (points.length > maxPoints) {
      points.splice(0, points.length - maxPoints);
    }

    storage.set(HISTORY_KEY(sessionId), JSON.stringify(points));
  },

  clear(sessionId: string): void {
    storage.delete(HISTORY_KEY(sessionId));
  },
};
```

---

## Step 6: Background Location Task

### tasks/locationSharing.ts

```typescript
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { locationHistory } from '@/services/locationHistory';
import { createLocationPoint, getAdaptiveInterval } from '@/services/locationSharing';

const LOCATION_SHARING_TASK = 'nomadsafe-location-sharing';

// Store session context in MMKV (task can't access React state)
const ACTIVE_SESSION_KEY = 'active-location-session';

TaskManager.defineTask(LOCATION_SHARING_TASK, async ({ data, error }) => {
  if (error) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const latest = locations[locations.length - 1];
  const point = await createLocationPoint(latest);

  // Read session ID from MMKV
  const sessionId = storage.getString(ACTIVE_SESSION_KEY);
  if (!sessionId) return;

  // Store locally
  locationHistory.addPoint(sessionId, point);

  // Sync to Convex (fire and forget)
  // Note: In background tasks, you can't use React hooks.
  // Use a direct fetch to Convex mutation endpoint or queue for next foreground.
});

export async function startLocationSharing(sessionId: string): Promise<void> {
  storage.set(ACTIVE_SESSION_KEY, sessionId);

  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  await Location.startLocationUpdatesAsync(LOCATION_SHARING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30000,
    distanceInterval: 10,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Sharing Location",
      notificationBody: "NomadSafe is sharing your location with your contacts.",
      notificationColor: "#0A84FF",
    },
    deferredUpdatesInterval: 30000,
    deferredUpdatesDistance: 10,
  });
}

export async function stopLocationSharing(): Promise<void> {
  storage.delete(ACTIVE_SESSION_KEY);
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_SHARING_TASK);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(LOCATION_SHARING_TASK);
  }
}
```

---

## Step 7: Zustand Store

### stores/locationStore.ts

```typescript
interface LocationState {
  // Own sessions
  ownSessions: Record<string, LocationSession>;
  activeSessionId: string | null;

  // Shared with me (from other users)
  sharedLocations: SharedUserLocation[];

  // Config
  shareConfig: ShareConfig;

  // Actions
  setOwnSessions: (sessions: LocationSession[]) => void;
  setActiveSession: (id: string | null) => void;
  setSharedLocations: (locations: SharedUserLocation[]) => void;
  updateShareConfig: (config: Partial<ShareConfig>) => void;
}

// Selectors
export const selectActiveSession = (state: LocationState) =>
  state.activeSessionId ? state.ownSessions[state.activeSessionId] ?? null : null;

export const selectSharedLocations = (state: LocationState) =>
  state.sharedLocations.filter((l) => !l.isStale);
```

Persisted via MMKV. Location points stored separately in locationHistory service (not in Zustand) to avoid bloating the store.

---

## Step 8: File Structure

```
app/
├── safety/
│   ├── location-sharing.tsx           (session list + management)
│   ├── map.tsx                        (full-screen map view)
│   └── share-session/
│       ├── create.tsx                 (create sharing session)
│       └── [sessionId].tsx            (session detail)
components/
├── location/
│   ├── MapView.tsx                    (react-native-maps wrapper)
│   ├── LocationMarker.tsx             (custom marker for users)
│   ├── LocationTrail.tsx              (polyline trail)
│   ├── ShareSessionCard.tsx           (session list item)
│   ├── BatteryIndicator.tsx           (battery level display)
│   └── LocationAccuracyBadge.tsx      (accuracy indicator)
stores/
├── locationStore.ts
types/
├── location.ts
services/
├── locationSharing.ts
├── locationHistory.ts
tasks/
├── locationSharing.ts
convex/
├── location.ts
├── schema.ts                          (MODIFY)
```

---

## Step 9: Screen Specs

### app/safety/location-sharing.tsx — Session Management

**Layout:**
- "Location Sharing" header with "+" create button
- Active sessions section (own sessions with pause/end controls)
- "Shared with me" section (other users sharing their location)
- Tap any session → opens map view

### app/safety/share-session/create.tsx — Create Session

**Layout:**
- Session name input (e.g., "Trip to Tokyo", "Evening Walk")
- "Share with" — contact picker (from emergency contacts or app users)
  - Searchable list of contacts who have accounts
- Battery optimization note: "Location updates adapt to your speed to save battery"
- "Start Sharing" button

### app/safety/share-session/[sessionId].tsx — Session Detail

**Layout:**
- Map showing your trail (LocationTrail polyline)
- Session info: started at, duration, points recorded
- Shared with: avatar list of recipients
- Controls: Pause / Resume / End session
- Battery level indicator
- Update interval indicator

### app/safety/map.tsx — Full-Screen Map

**Layout:**
- Full-screen MapView
- User markers (LocationMarker for each shared user)
- Polyline trails for each user
- "Center on me" FAB button
- Bottom sheet with user list (tappable to focus map on user)
- Each user shows: name, last update time, battery, accuracy

---

## Step 10: Component Specs

### MapView (wrapper)
| Prop | Type |
|------|------|
| locations | SharedUserLocation[] |
| ownTrail | LocationPoint[] |
| initialRegion | Region |
| onMarkerPress | (userId: string) => void |

Wraps react-native-maps. Renders markers, polylines, and current user indicator.

### LocationMarker
| Prop | Type |
|------|------|
| user | SharedUserLocation |
| isSelected | boolean |

Custom marker: avatar circle with user initial, colored border (green = recent, yellow = slightly stale, gray = stale).
Callout shows: name, last update time, battery level.

### LocationTrail
| Prop | Type |
|------|------|
| points | LocationPoint[] |
| color | string |

react-native-maps Polyline with gradient opacity (newer points = more opaque).

### ShareSessionCard
| Prop | Type |
|------|------|
| session | LocationSession |
| onPress | () => void |
| onPause | () => void |
| onEnd | () => void |

Card showing: session name, status badge, duration, shared count, action buttons.

### BatteryIndicator
| Prop | Type |
|------|------|
| level | number (0-1) |

Small battery icon with fill level. Colors: green (>50%), yellow (20-50%), red (<20%).

### LocationAccuracyBadge
| Prop | Type |
|------|------|
| accuracy | number (meters) |

Badge: "±Xm". Colors: green (<10m), yellow (10-50m), red (>50m).

---

## Step-by-Step Build Order

1. [ ] Add locationSessions and locationPoints tables to `convex/schema.ts`
2. [ ] Create `convex/location.ts` (queries + mutations)
3. [ ] Deploy: `npx convex dev`
4. [ ] Add Google Maps API key to `app.json` (Android)
5. [ ] Create `types/location.ts`
6. [ ] Create `services/locationSharing.ts`
7. [ ] Create `services/locationHistory.ts`
8. [ ] Create `tasks/locationSharing.ts`
9. [ ] Create `stores/locationStore.ts`
10. [ ] Create `components/location/LocationMarker.tsx`
11. [ ] Create `components/location/LocationTrail.tsx`
12. [ ] Create `components/location/MapView.tsx`
13. [ ] Create `components/location/ShareSessionCard.tsx`
14. [ ] Create `components/location/BatteryIndicator.tsx`
15. [ ] Create `components/location/LocationAccuracyBadge.tsx`
16. [ ] Create `app/safety/location-sharing.tsx`
17. [ ] Create `app/safety/share-session/create.tsx`
18. [ ] Create `app/safety/share-session/[sessionId].tsx`
19. [ ] Create `app/safety/map.tsx`
20. [ ] Wire up foreground location tracking → Convex mutations
21. [ ] Wire up background location task
22. [ ] Wire up Convex real-time queries → locationStore
23. [ ] Add location sharing link on safety dashboard
24. [ ] Test: create session → start sharing → see own location on map
25. [ ] Test: share with another user → they see your location in real-time
26. [ ] Test: pause/resume/end session
27. [ ] Test: adaptive intervals — stationary vs walking vs driving
28. [ ] Test: background sharing — app backgrounded, location still updates
29. [ ] Test: local history ring buffer (verify pruning after 1000 points)
30. [ ] Test: map markers with accuracy badges and battery indicators
31. [ ] Test: trail polyline renders correctly
32. [ ] Run `pnpm lint`

---

## Verification

1. Create sharing session → select contacts → location appears on map
2. Walk with phone → trail polyline follows movement
3. Map shows custom markers for all shared users
4. Pause session → updates stop → resume → updates restart
5. End session → session marked as ended, no more updates
6. Background: minimize app → location continues to update on Convex
7. Adaptive intervals: stationary (updates slow), walking (moderate), driving (fast)
8. Battery indicator shows current level on markers
9. Accuracy badge shows GPS accuracy
10. Stale locations (>10 min) shown with gray marker
11. Local history persists: kill app, reopen → trail data intact
