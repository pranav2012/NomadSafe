# Phase 4: SOS Safety Engine

## Overview

This phase builds the emergency safety system — the core safety promise of NomadSafe. Features: emergency contact management, SOS trigger (manual hold, shake, crash detection), background location capture, SMS fallback alerts, smart check-in timers, and SOS history. Safety-critical data is stored locally (MMKV) so everything works offline.

## Dependencies

- Phase 1 (design system, auth, storage, navigation)

---

## Step 1: Install Packages

```bash
npx expo install expo-location expo-sensors expo-sms expo-notifications expo-task-manager expo-background-fetch
```

## Step 2: app.json Additions

### Plugins
```json
{
  "plugins": [
    ["expo-location", {
      "locationAlwaysAndWhenInUsePermission": "NomadSafe uses your location for emergency SOS alerts and location sharing.",
      "locationWhenInUsePermission": "NomadSafe uses your location to share with emergency contacts.",
      "isIosBackgroundLocationEnabled": true,
      "isAndroidBackgroundLocationEnabled": true,
      "isAndroidForegroundServiceEnabled": true
    }],
    ["expo-notifications", {
      "icon": "./assets/images/icon.png",
      "color": "#0A84FF"
    }]
  ]
}
```

### Android Permissions
```json
{
  "android": {
    "permissions": [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "SEND_SMS",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "RECEIVE_BOOT_COMPLETED"
    ]
  }
}
```

### iOS Info.plist (via app.json)
```json
{
  "ios": {
    "infoPlist": {
      "NSMotionUsageDescription": "NomadSafe uses motion sensors for crash detection safety features.",
      "UIBackgroundModes": ["location", "fetch", "remote-notification"]
    }
  }
}
```

---

## Step 3: TypeScript Types

### types/safety.ts

```typescript
import type { Id } from "@/convex/_generated/dataModel";

export interface EmergencyContact {
  id: string;                      // local ID (MMKV)
  convexId?: Id<"emergencyContacts">; // synced Convex ID
  name: string;
  phone: string;
  relationship: string;            // e.g., "Mother", "Partner", "Friend"
  isPrimary: boolean;
  notifyOnSOS: boolean;
  notifyOnMissedCheckIn: boolean;
  createdAt: number;
}

export type SOSStatus = "idle" | "countdown" | "active" | "resolved";
export type SOSTrigger = "manual" | "shake" | "crash_detected" | "missed_checkin";

export interface SOSLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  timestamp: number;
}

export interface SOSEvent {
  id: string;
  status: SOSStatus;
  trigger: SOSTrigger;
  location: SOSLocation | null;
  contactsNotified: string[];      // contact IDs
  smsResults: Array<{
    contactId: string;
    success: boolean;
    timestamp: number;
  }>;
  startedAt: number;
  resolvedAt: number | null;
  notes: string;
}

export interface CheckInConfig {
  enabled: boolean;
  intervalMinutes: number;         // 60, 120, 240
  lastCheckInAt: number | null;
  nextCheckInDue: number | null;
  graceMinutes: number;            // default 15
}

export interface SafetySettings {
  crashDetectionEnabled: boolean;
  shakeDetectionEnabled: boolean;
  sosCountdownSeconds: number;     // default 10
  userName: string;                // included in SOS SMS
}
```

---

## Step 4: Convex Schema (Synced Backup)

### convex/schema.ts (MODIFY)

```typescript
emergencyContacts: defineTable({
  userId: v.id("users"),
  name: v.string(),
  phone: v.string(),
  relationship: v.string(),
  isPrimary: v.boolean(),
  notifyOnSOS: v.boolean(),
  notifyOnMissedCheckIn: v.boolean(),
  createdAt: v.number(),
})
  .index("by_user", ["userId"]),

sosEvents: defineTable({
  userId: v.id("users"),
  status: v.string(),
  trigger: v.string(),
  location: v.optional(v.object({
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.number(),
    altitude: v.optional(v.number()),
    timestamp: v.number(),
  })),
  contactsNotified: v.array(v.string()),
  startedAt: v.number(),
  resolvedAt: v.optional(v.number()),
  notes: v.string(),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"]),
```

### convex/safety.ts

**Queries:** getEmergencyContacts, getSOSHistory, getActiveSOSEvent
**Mutations:** syncEmergencyContact, logSOSEvent, updateSOSEvent

These serve as cloud backup. The local MMKV store is the primary source of truth for safety data.

---

## Step 5: Zustand Store (Local-First)

### stores/safetyStore.ts

```typescript
interface SafetyState {
  // Emergency contacts (primary data source — MMKV persisted)
  emergencyContacts: Record<string, EmergencyContact>;

  // SOS state
  currentSOS: SOSEvent | null;
  sosHistory: SOSEvent[];

  // Check-in
  checkIn: CheckInConfig;

  // Settings
  settings: SafetySettings;

  // Contact management
  addContact: (contact: Omit<EmergencyContact, 'id' | 'createdAt'>) => string;
  updateContact: (id: string, updates: Partial<EmergencyContact>) => void;
  removeContact: (id: string) => void;

  // SOS lifecycle
  startSOSCountdown: (trigger: SOSTrigger) => void;
  cancelSOS: () => void;
  activateSOS: (location: SOSLocation | null) => void;
  recordSMSResult: (contactId: string, success: boolean) => void;
  resolveSOS: (notes?: string) => void;

  // Check-in
  updateCheckInConfig: (config: Partial<CheckInConfig>) => void;
  performCheckIn: () => void;
  resetCheckInTimer: () => void;

  // Settings
  updateSettings: (settings: Partial<SafetySettings>) => void;
}

// Selectors
export const selectPrimaryContact = (state: SafetyState) =>
  Object.values(state.emergencyContacts).find((c) => c.isPrimary);

export const selectSOSContacts = (state: SafetyState) =>
  Object.values(state.emergencyContacts).filter((c) => c.notifyOnSOS);

export const selectCheckInContacts = (state: SafetyState) =>
  Object.values(state.emergencyContacts).filter((c) => c.notifyOnMissedCheckIn);

export const selectIsSOSActive = (state: SafetyState) =>
  state.currentSOS?.status === "active" || state.currentSOS?.status === "countdown";
```

All persisted via MMKV.

---

## Step 6: SOS Service

### services/sosService.ts

```typescript
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';

export const sosService = {
  /**
   * Capture current device location.
   * Requests foreground permission if not already granted.
   */
  async getCurrentLocation(): Promise<SOSLocation | null> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? 0,
      altitude: location.coords.altitude,
      timestamp: location.timestamp,
    };
  },

  /**
   * Compose and send SOS SMS to emergency contacts.
   * Returns results per contact.
   */
  async sendSOSAlerts(
    contacts: EmergencyContact[],
    location: SOSLocation | null,
    userName: string
  ): Promise<Array<{ contactId: string; success: boolean }>> {
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) {
      return contacts.map((c) => ({ contactId: c.id, success: false }));
    }

    const locationUrl = location
      ? `https://maps.google.com/?q=${location.latitude},${location.longitude}`
      : "Location unavailable";

    const message = [
      `🚨 EMERGENCY ALERT`,
      `${userName} has triggered an SOS alert from NomadSafe.`,
      ``,
      `📍 Location: ${locationUrl}`,
      `🕐 Time: ${new Date().toLocaleString()}`,
      ``,
      `Please check on them immediately.`,
    ].join("\n");

    const results: Array<{ contactId: string; success: boolean }> = [];

    for (const contact of contacts) {
      try {
        const { result } = await SMS.sendSMSAsync([contact.phone], message);
        results.push({
          contactId: contact.id,
          success: result === "sent" || result === "unknown", // "unknown" on Android means it was sent
        });
      } catch {
        results.push({ contactId: contact.id, success: false });
      }
    }

    return results;
  },

  /**
   * Full SOS trigger flow:
   * 1. Capture location
   * 2. Send SMS to all SOS contacts
   * 3. Record results in store
   * 4. Sync event to Convex (if online)
   */
  async executeSOSAlert(
    contacts: EmergencyContact[],
    userName: string,
    store: SafetyState
  ): Promise<void> {
    const location = await this.getCurrentLocation();
    store.activateSOS(location);

    const results = await this.sendSOSAlerts(contacts, location, userName);
    for (const result of results) {
      store.recordSMSResult(result.contactId, result.success);
    }

    // Sync to Convex when online (fire and forget)
    // convexMutation(api.safety.logSOSEvent, { ... });
  },
};
```

---

## Step 7: Crash Detection Service

### services/crashDetection.ts

```typescript
import { Accelerometer } from 'expo-sensors';

const CRASH_THRESHOLD_G = 4.0;        // G-force spike threshold
const STILLNESS_THRESHOLD_G = 0.5;    // G-force for "still"
const STILLNESS_DURATION_MS = 5000;   // Must be still for 5 seconds
const DEBOUNCE_MS = 30000;            // Ignore triggers within 30s

interface CrashDetectionCallbacks {
  onCrashDetected: () => void;
}

let subscription: ReturnType<typeof Accelerometer.addListener> | null = null;
let lastTriggerTime = 0;

export const crashDetection = {
  start(callbacks: CrashDetectionCallbacks) {
    Accelerometer.setUpdateInterval(10); // ~100Hz

    let spikeDetectedAt: number | null = null;
    let stillSince: number | null = null;

    subscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();

      // Phase 1: Detect impact spike
      if (!spikeDetectedAt && magnitude > CRASH_THRESHOLD_G) {
        spikeDetectedAt = now;
        stillSince = null;
        return;
      }

      // Phase 2: After spike, monitor for stillness
      if (spikeDetectedAt) {
        if (magnitude < STILLNESS_THRESHOLD_G) {
          if (!stillSince) stillSince = now;

          if (now - stillSince >= STILLNESS_DURATION_MS) {
            // Crash pattern detected: spike + prolonged stillness
            if (now - lastTriggerTime > DEBOUNCE_MS) {
              lastTriggerTime = now;
              callbacks.onCrashDetected();
            }
            spikeDetectedAt = null;
            stillSince = null;
          }
        } else {
          stillSince = null;
          // If 30s passed since spike without stillness, reset
          if (now - spikeDetectedAt > 30000) {
            spikeDetectedAt = null;
          }
        }
      }
    });
  },

  stop() {
    subscription?.remove();
    subscription = null;
  },
};
```

---

## Step 8: Check-In Service

### services/checkInService.ts

```typescript
import * as Notifications from 'expo-notifications';

export const checkInService = {
  /**
   * Schedule check-in reminder notification.
   */
  async scheduleCheckInReminder(nextDueTimestamp: number): Promise<string> {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Check-in Reminder",
        body: "Tap to check in and let your contacts know you're safe.",
        data: { type: "check-in" },
        sound: true,
      },
      trigger: { date: new Date(nextDueTimestamp) },
    });
    return identifier;
  },

  /**
   * Schedule grace period alert (fires if check-in missed).
   */
  async scheduleGraceAlert(graceDueTimestamp: number): Promise<string> {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Check-in Overdue",
        body: "You missed your check-in. Your emergency contacts will be notified in a few minutes.",
        data: { type: "check-in-grace" },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: { date: new Date(graceDueTimestamp) },
    });
    return identifier;
  },

  /**
   * Cancel all scheduled check-in notifications.
   */
  async cancelAll(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  },

  /**
   * Handle missed check-in: send alerts to emergency contacts.
   */
  async handleMissedCheckIn(
    contacts: EmergencyContact[],
    userName: string,
    location: SOSLocation | null
  ): Promise<void> {
    // Similar to SOS alert but with different message:
    // "[Name] missed their scheduled check-in on NomadSafe."
  },
};
```

---

## Step 9: Background Tasks

### tasks/backgroundLocation.ts

```typescript
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

const BACKGROUND_LOCATION_TASK = 'nomadsafe-background-location';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, ({ data, error }) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  // Store latest location in MMKV for SOS use
  // Update safetyStore with latest coordinates
});

export async function startBackgroundLocation(): Promise<void> {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 60000,       // every 60 seconds
    distanceInterval: 50,      // or every 50 meters
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "NomadSafe Safety Active",
      notificationBody: "Your location is being monitored for safety.",
      notificationColor: "#0A84FF",
    },
  });
}

export async function stopBackgroundLocation(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
```

### tasks/checkInMonitor.ts

```typescript
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

const CHECK_IN_TASK = 'nomadsafe-checkin-monitor';

TaskManager.defineTask(CHECK_IN_TASK, async () => {
  // Read check-in config from MMKV
  // If check-in is overdue + grace period expired:
  //   - Trigger missed check-in alert
  // Return BackgroundFetch.BackgroundFetchResult.NewData or NoData
});

export async function registerCheckInMonitor(): Promise<void> {
  await BackgroundFetch.registerTaskAsync(CHECK_IN_TASK, {
    minimumInterval: 15 * 60, // check every 15 minutes
    stopOnTerminate: false,
    startOnBoot: true,
  });
}
```

---

## Step 10: File Structure

```
app/
├── (tabs)/
│   └── safety.tsx                     (MODIFY — SOS dashboard)
├── safety/
│   ├── _layout.tsx                    (safety stack)
│   ├── emergency-contacts.tsx         (manage contacts)
│   ├── sos-active.tsx                 (active SOS screen)
│   ├── check-in.tsx                   (check-in timer settings)
│   └── history.tsx                    (SOS event history)
components/
├── safety/
│   ├── SOSButton.tsx                  (hold-to-activate button)
│   ├── EmergencyContactCard.tsx
│   ├── CheckInTimer.tsx               (countdown display)
│   ├── SOSCountdown.tsx               (10-9-8... cancel overlay)
│   ├── SOSActiveOverlay.tsx           (full-screen SOS active)
│   └── CrashDetectionBanner.tsx       ("Are you okay?" prompt)
stores/
├── safetyStore.ts
types/
├── safety.ts
services/
├── sosService.ts
├── crashDetection.ts
├── checkInService.ts
tasks/
├── backgroundLocation.ts
├── checkInMonitor.ts
convex/
├── safety.ts
├── schema.ts                          (MODIFY)
```

---

## Step 11: Screen Specs

### app/(tabs)/safety.tsx — SOS Dashboard

**Layout:**
- Large SOSButton (centered, prominent red circle)
- Below: quick status cards
  - Emergency contacts count + "Manage" link
  - Check-in timer status (enabled/disabled, next due)
  - Crash detection status (on/off)
  - Shake detection status (on/off)
- "SOS History" link at bottom

### app/safety/emergency-contacts.tsx — Contact Management

- List of EmergencyContactCard components
- "Add Contact" button → BottomSheet with form:
  - Name, Phone number, Relationship
  - Toggle: Notify on SOS
  - Toggle: Notify on missed check-in
  - Toggle: Set as primary
- Swipe to delete
- Tap to edit
- Must have at least 1 contact to enable SOS

### app/safety/sos-active.tsx — Active SOS

**When SOS is in countdown:**
- Full-screen red overlay
- Large countdown number (10, 9, 8...)
- "CANCEL" button (large, easy to hit)
- Trigger type indicator ("Manual SOS" / "Crash Detected" / etc.)

**When SOS is active:**
- "SOS ACTIVE" header
- Location map preview (if available)
- List of contacts with send status (✓ sent, ✕ failed, ⏳ sending)
- "I'm Safe" button to resolve
- Elapsed time counter

### app/safety/check-in.tsx — Check-In Settings

- Enable/disable toggle
- Interval picker: 1 hour / 2 hours / 4 hours / 8 hours
- Grace period: 15 min / 30 min
- "Check In Now" button (performs immediate check-in)
- Last check-in time display
- Next check-in due display

### app/safety/history.tsx — SOS History

- List of past SOSEvent entries
- Each shows: trigger type, timestamp, location, resolution status
- Tap for detail view

---

## Step 12: Component Specs

### SOSButton

| Prop | Type |
|------|------|
| onActivate | () => void |
| disabled | boolean |

Large red circular button (120x120). Must hold for 3 seconds to activate.
Visual feedback: fills with darker red as hold progresses (Reanimated animated ring).
Haptic: heavy impact at activation.
Pulsing animation when idle.

### SOSCountdown

| Prop | Type |
|------|------|
| seconds | number |
| onCancel | () => void |
| trigger | SOSTrigger |

Full-screen overlay. Large countdown number with shrinking circle animation.
"CANCEL" button prominent at bottom.
Haptic tick on each second.

### SOSActiveOverlay

| Prop | Type |
|------|------|
| event | SOSEvent |
| onResolve | () => void |

Full-screen display of active SOS with contact notification status.

### EmergencyContactCard

| Prop | Type |
|------|------|
| contact | EmergencyContact |
| onPress | () => void |
| onDelete | () => void |

Shows: name, phone, relationship, primary badge, notification toggles.

### CheckInTimer

| Prop | Type |
|------|------|
| config | CheckInConfig |
| onCheckIn | () => void |

Displays time until next check-in. "Check In" button. Warning state when overdue.

### CrashDetectionBanner

| Prop | Type |
|------|------|
| visible | boolean |
| countdown | number (seconds) |
| onImSafe | () => void |
| onCallSOS | () => void |

Alert banner: "Possible crash detected. Are you okay?"
Two buttons: "I'm Safe" / "Call SOS"
Auto-triggers SOS after countdown reaches 0.

---

## Step-by-Step Build Order

1. [ ] Add emergencyContacts and sosEvents tables to `convex/schema.ts`
2. [ ] Create `convex/safety.ts` (backup sync queries/mutations)
3. [ ] Deploy: `npx convex dev`
4. [ ] Update `app.json` with location, notification, sensor plugins and permissions
5. [ ] Create `types/safety.ts`
6. [ ] Create `stores/safetyStore.ts`
7. [ ] Create `services/secureStorage.ts` updates if needed
8. [ ] Create `utils/haptics.ts` updates (heavy impact pattern)
9. [ ] Create `services/sosService.ts`
10. [ ] Create `services/crashDetection.ts`
11. [ ] Create `services/checkInService.ts`
12. [ ] Create `tasks/backgroundLocation.ts`
13. [ ] Create `tasks/checkInMonitor.ts`
14. [ ] Create `components/safety/SOSButton.tsx`
15. [ ] Create `components/safety/SOSCountdown.tsx`
16. [ ] Create `components/safety/SOSActiveOverlay.tsx`
17. [ ] Create `components/safety/EmergencyContactCard.tsx`
18. [ ] Create `components/safety/CheckInTimer.tsx`
19. [ ] Create `components/safety/CrashDetectionBanner.tsx`
20. [ ] Create `app/safety/_layout.tsx`
21. [ ] Create `app/safety/emergency-contacts.tsx`
22. [ ] Create `app/safety/sos-active.tsx`
23. [ ] Create `app/safety/check-in.tsx`
24. [ ] Create `app/safety/history.tsx`
25. [ ] Modify `app/(tabs)/safety.tsx` — SOS dashboard
26. [ ] Wire up crash detection start/stop in safety tab
27. [ ] Wire up check-in timer scheduling
28. [ ] Wire up Convex backup sync for contacts and SOS events
29. [ ] Test: add 3 emergency contacts
30. [ ] Test: hold SOS button → countdown → cancel
31. [ ] Test: hold SOS button → countdown → SOS activates → SMS sends
32. [ ] Test: shake detection triggers SOS countdown
33. [ ] Test: crash detection (simulate with rapid phone shake then stillness)
34. [ ] Test: check-in timer → notification fires → check in
35. [ ] Test: missed check-in → grace period → alert
36. [ ] Test: SOS works with airplane mode (offline, SMS still sends)
37. [ ] Test: SOS history shows past events
38. [ ] Run `pnpm lint`

---

## Verification

1. Add 3 emergency contacts → all saved, persist across app restart
2. SOS button requires 3-second hold → countdown starts
3. Cancel during countdown → SOS not sent
4. Full SOS: countdown → capture location → send SMS to contacts → active screen shows results
5. Shake phone vigorously → SOS countdown triggers
6. Crash detection: sharp impact followed by stillness → "Are you okay?" prompt
7. Check-in timer: set to 1 hour → notification fires after 1 hour
8. Missed check-in: no response after grace → contacts alerted
9. Airplane mode: SOS still triggers, SMS still queues (platform handles delivery)
10. SOS history shows all past events with details
11. Contacts sync to Convex when online
