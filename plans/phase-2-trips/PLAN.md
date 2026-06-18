# Phase 2: Trip Management

## Overview

This phase adds solo and group trip management — CRUD operations, member management, status tracking, and real-time sync via Convex. Users can create solo trips (personal expense tracking) or group trips (shared expenses with splitting).

## Dependencies

- Phase 1 complete (design system, auth, Convex, MMKV + Zustand, navigation shell)

---

## Step 1: Install Packages

```bash
pnpm add uuid && pnpm add -D @types/uuid
```

No other new packages needed.

---

## Step 2: Convex Schema Additions

### convex/schema.ts (MODIFY — add trips and tripMembers tables)

```typescript
trips: defineTable({
  title: v.string(),
  destination: v.string(),
  description: v.string(),
  currency: v.string(),          // ISO 4217 (e.g., "USD", "EUR")
  startDate: v.string(),         // ISO 8601 date (e.g., "2026-03-15")
  endDate: v.string(),
  status: v.union(
    v.literal("upcoming"),
    v.literal("active"),
    v.literal("completed"),
    v.literal("cancelled")
  ),
  isGroup: v.boolean(),
  coverColor: v.string(),        // hex color for card UI
  ownerId: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner", ["ownerId"])
  .index("by_status", ["status"])
  .index("by_owner_status", ["ownerId", "status"]),

tripMembers: defineTable({
  tripId: v.id("trips"),
  userId: v.optional(v.id("users")),  // linked user if they have an account
  name: v.string(),
  avatarColor: v.string(),            // auto-assigned from palette
  isOwner: v.boolean(),
  createdAt: v.number(),
})
  .index("by_trip", ["tripId"])
  .index("by_user", ["userId"]),
```

---

## Step 3: Convex Functions

### convex/trips.ts

**Queries:**

```typescript
// getTrips — get all trips for current user (as owner or member)
export const getTrips = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx); // from auth helper
    if (!user) return [];

    // Get trips owned by user
    const ownedTrips = await ctx.db
      .query("trips")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();

    // Get trips where user is a member
    const memberships = await ctx.db
      .query("tripMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const memberTripIds = memberships.map((m) => m.tripId);
    const memberTrips = await Promise.all(
      memberTripIds.map((id) => ctx.db.get(id))
    );

    // Merge and deduplicate
    // Return sorted by createdAt desc
  },
});

// getTripById — get single trip with members
export const getTripById = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }) => {
    const trip = await ctx.db.get(tripId);
    if (!trip) return null;

    const members = await ctx.db
      .query("tripMembers")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .collect();

    return { ...trip, members };
  },
});

// getTripMembers — get members for a trip
export const getTripMembers = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }) => {
    return await ctx.db
      .query("tripMembers")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .collect();
  },
});
```

**Mutations:**

```typescript
// createTrip — create a new trip + add owner as first member
export const createTrip = mutation({
  args: {
    title: v.string(),
    destination: v.string(),
    description: v.string(),
    currency: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    isGroup: v.boolean(),
    coverColor: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

    const now = Date.now();
    const status = computeStatus(args.startDate, args.endDate);

    const tripId = await ctx.db.insert("trips", {
      ...args,
      status,
      ownerId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    // Add owner as first member
    await ctx.db.insert("tripMembers", {
      tripId,
      userId: user._id,
      name: user.name,
      avatarColor: generateAvatarColor(0),
      isOwner: true,
      createdAt: now,
    });

    return tripId;
  },
});

// updateTrip — update trip details
export const updateTrip = mutation({
  args: {
    tripId: v.id("trips"),
    title: v.optional(v.string()),
    destination: v.optional(v.string()),
    description: v.optional(v.string()),
    currency: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    coverColor: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("upcoming"), v.literal("active"),
      v.literal("completed"), v.literal("cancelled")
    )),
  },
  handler: async (ctx, { tripId, ...updates }) => {
    // Verify ownership
    // Patch with updatedAt: Date.now()
  },
});

// deleteTrip — delete trip and all its members
export const deleteTrip = mutation({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }) => {
    // Verify ownership
    // Delete all tripMembers for this trip
    // Delete the trip
  },
});

// addMember — add a member to a group trip
export const addMember = mutation({
  args: {
    tripId: v.id("trips"),
    name: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, { tripId, name, userId }) => {
    // Verify trip exists and is a group trip
    // Count existing members for avatar color index
    // Insert tripMember
  },
});

// removeMember — remove a member (cannot remove owner)
export const removeMember = mutation({
  args: { memberId: v.id("tripMembers") },
  handler: async (ctx, { memberId }) => {
    const member = await ctx.db.get(memberId);
    if (!member) throw new Error("Member not found");
    if (member.isOwner) throw new Error("Cannot remove trip owner");
    await ctx.db.delete(memberId);
  },
});

// updateMember — update member name
export const updateMember = mutation({
  args: {
    memberId: v.id("tripMembers"),
    name: v.string(),
  },
  handler: async (ctx, { memberId, name }) => {
    await ctx.db.patch(memberId, { name });
  },
});
```

**Scheduled Function (auto-status transitions):**

```typescript
// convex/crons.ts (or run on client-side read)
// Check trips daily: upcoming → active (if startDate <= today), active → completed (if endDate < today)

export const updateTripStatuses = mutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0];
    // Query upcoming trips where startDate <= today → patch to "active"
    // Query active trips where endDate < today → patch to "completed"
  },
});
```

---

## Step 4: TypeScript Types

### types/trip.ts

```typescript
import type { Id } from "@/convex/_generated/dataModel";

export type TripStatus = "upcoming" | "active" | "completed" | "cancelled";

export interface TripMember {
  _id: Id<"tripMembers">;
  tripId: Id<"trips">;
  userId?: Id<"users">;
  name: string;
  avatarColor: string;
  isOwner: boolean;
  createdAt: number;
}

export interface Trip {
  _id: Id<"trips">;
  title: string;
  destination: string;
  description: string;
  currency: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  isGroup: boolean;
  coverColor: string;
  ownerId: Id<"users">;
  createdAt: number;
  updatedAt: number;
}

export interface TripWithMembers extends Trip {
  members: TripMember[];
}
```

---

## Step 5: Zustand Store

### stores/tripStore.ts

```typescript
interface TripState {
  trips: Record<string, TripWithMembers>;
  activeTripId: string | null;
  isLoading: boolean;

  // Actions (called by sync hook when Convex data changes)
  setTrips: (trips: TripWithMembers[]) => void;
  setActiveTripId: (id: string | null) => void;
  setLoading: (value: boolean) => void;

  // Optimistic update helpers
  addTripOptimistic: (trip: TripWithMembers) => void;
  removeTripOptimistic: (id: string) => void;
  updateTripOptimistic: (id: string, updates: Partial<Trip>) => void;
}

// Selectors
export const selectTripList = (state: TripState) =>
  Object.values(state.trips).sort((a, b) => b.createdAt - a.createdAt);

export const selectTripsByStatus = (status: TripStatus) => (state: TripState) =>
  Object.values(state.trips)
    .filter((t) => t.status === status)
    .sort((a, b) => b.createdAt - a.createdAt);

export const selectActiveTrip = (state: TripState) =>
  state.activeTripId ? state.trips[state.activeTripId] ?? null : null;

export const selectGroupTrips = (state: TripState) =>
  Object.values(state.trips).filter((t) => t.isGroup);

export const selectSoloTrips = (state: TripState) =>
  Object.values(state.trips).filter((t) => !t.isGroup);
```

Persisted via MMKV (trips data available offline).

---

## Step 6: Utility Functions

### utils/id.ts
```typescript
import { v4 as uuidv4 } from 'uuid';
export const generateId = () => uuidv4();
```

### utils/date.ts
```typescript
// formatDate(dateString) → "Mar 15, 2026"
// formatDateRange(start, end) → "Mar 15 – Mar 22, 2026"
// daysUntil(dateString) → number (negative if past)
// isDateInRange(date, start, end) → boolean
// getTripDuration(start, end) → number of days
```

### Avatar color palette
```typescript
// constants/avatarColors.ts
export const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA',
];

export const generateAvatarColor = (index: number) =>
  AVATAR_COLORS[index % AVATAR_COLORS.length];
```

---

## Step 7: File Structure (New Files)

```
app/
├── (tabs)/
│   ├── trips.tsx                    (MODIFY — trip list screen)
│   └── index.tsx                    (MODIFY — active trip widget on dashboard)
├── trip/
│   ├── _layout.tsx                  (trip stack navigator)
│   ├── create.tsx                   (create/edit trip form)
│   └── [id]/
│       ├── _layout.tsx              (trip detail layout)
│       ├── index.tsx                (trip overview/detail)
│       ├── members.tsx              (member management — group trips)
│       └── settings.tsx             (trip settings, delete)
components/
├── trips/
│   ├── TripCard.tsx                 (trip list item card)
│   ├── TripForm.tsx                 (reusable create/edit form)
│   ├── MemberList.tsx               (horizontal avatar list with add button)
│   ├── MemberInvite.tsx             (add member bottom sheet)
│   └── TripStatusBadge.tsx          (colored status badge)
stores/
├── tripStore.ts
types/
├── trip.ts
utils/
├── id.ts
├── date.ts
constants/
├── avatarColors.ts
convex/
├── trips.ts
├── schema.ts                        (MODIFY)
```

---

## Step 8: Screen Specs

### app/(tabs)/trips.tsx — Trip List

**Layout:**
- Top: "Trips" header with "+" button (navigate to trip/create)
- Filter chips row: All | Upcoming | Active | Completed
- FlatList of TripCard components
- EmptyState when no trips for selected filter

**Data flow:**
- Convex `useQuery(api.trips.getTrips)` → syncs to tripStore
- UI reads from `useTripStore(selectTripsByStatus(filter))`

### app/trip/create.tsx — Create Trip

**Layout:**
- Solo / Group toggle at top (segmented control)
- Form fields:
  - Title (Input)
  - Destination (Input)
  - Description (Input, multiline)
  - Currency picker (BottomSheet with searchable list)
  - Start Date picker (BottomSheet with date scroll)
  - End Date picker
  - Cover color picker (horizontal color dot row)
- If Group: "Add Members" section with MemberInvite
- "Create Trip" button at bottom

**Data flow:**
- On submit: `useMutation(api.trips.createTrip)` with form data
- Optimistic: add to tripStore immediately
- Navigate to trip/[id] on success

### app/trip/[id]/index.tsx — Trip Detail

**Layout:**
- Header with trip title, destination, cover color background
- Status badge (TripStatusBadge)
- Date range display
- Member avatars row (MemberList) — tap to go to members screen
- Quick stats: days remaining / total days, member count
- Action buttons: "Add Expense" (placeholder → Phase 3), "View Expenses" (placeholder)
- If owner: edit button in header

### app/trip/[id]/members.tsx — Member Management

**Layout:**
- List of members with avatar, name, role (Owner badge)
- "Add Member" button (opens MemberInvite bottom sheet)
- Swipe to remove (not owner)
- Tap to edit name

Only shown for group trips. Solo trips redirect to trip detail.

### app/trip/[id]/settings.tsx — Trip Settings

**Layout:**
- Edit trip details (opens create form in edit mode)
- Change currency
- Change trip status manually (e.g., mark completed early)
- "Delete Trip" danger button with confirmation modal

### app/(tabs)/index.tsx — Dashboard (MODIFY)

Add active trip widget:
- If there's an active trip: show card with trip name, destination, days remaining, quick actions
- If no active trip: show "No active trip" with "Create Trip" button

---

## Step 9: Component Specs

### TripCard

| Prop | Type |
|------|------|
| trip | TripWithMembers |
| onPress | () => void |

Displays: cover color strip on left, title, destination, date range, member avatar stack, status badge.
Animated press feedback (scale down 0.98).

### TripForm

| Prop | Type |
|------|------|
| initialValues | Partial\<Trip\> (for edit mode) |
| onSubmit | (data: CreateTripData) => void |
| isLoading | boolean |
| mode | 'create' \| 'edit' |

Handles all form validation:
- Title: required, max 100 chars
- Destination: required
- Start date: required, must be today or future (for new trips)
- End date: required, must be after start date
- Currency: required

### MemberList

| Prop | Type |
|------|------|
| members | TripMember[] |
| onAddPress | () => void |
| onMemberPress | (member: TripMember) => void |
| showAddButton | boolean |

Horizontal scrolling avatar row. "+" button at end for adding members.

### MemberInvite

| Prop | Type |
|------|------|
| visible | boolean |
| onClose | () => void |
| onAdd | (name: string) => void |

BottomSheet with name input. For now, just adds by name (no account linking).
Future: could add phone number to invite via the app.

### TripStatusBadge

| Prop | Type |
|------|------|
| status | TripStatus |

Colors: upcoming → blue, active → green, completed → gray, cancelled → red.

---

## Step-by-Step Build Order

1. [ ] Add trips and tripMembers tables to `convex/schema.ts`
2. [ ] Create `convex/trips.ts` with all queries and mutations
3. [ ] Run `npx convex dev` to deploy schema changes
4. [ ] Create `types/trip.ts`
5. [ ] Create `constants/avatarColors.ts`
6. [ ] Create `utils/id.ts` and `utils/date.ts`
7. [ ] Create `stores/tripStore.ts`
8. [ ] Create `components/trips/TripStatusBadge.tsx`
9. [ ] Create `components/trips/TripCard.tsx`
10. [ ] Create `components/trips/MemberList.tsx`
11. [ ] Create `components/trips/MemberInvite.tsx`
12. [ ] Create `components/trips/TripForm.tsx`
13. [ ] Create `app/trip/_layout.tsx`
14. [ ] Create `app/trip/create.tsx`
15. [ ] Create `app/trip/[id]/_layout.tsx`
16. [ ] Create `app/trip/[id]/index.tsx`
17. [ ] Create `app/trip/[id]/members.tsx`
18. [ ] Create `app/trip/[id]/settings.tsx`
19. [ ] Modify `app/(tabs)/trips.tsx` — trip list with filters
20. [ ] Modify `app/(tabs)/index.tsx` — add active trip widget
21. [ ] Wire up Convex sync: useQuery → tripStore
22. [ ] Test: create solo trip → appears in list → detail view works
23. [ ] Test: create group trip → add members → member management works
24. [ ] Test: edit trip → changes sync
25. [ ] Test: delete trip → removed from list
26. [ ] Test: auto-status transition (set dates to test upcoming→active→completed)
27. [ ] Test: offline — trip data persists from MMKV when Convex is unavailable
28. [ ] Run `pnpm lint`

---

## Verification

1. Create a solo trip → shows in trip list with "Solo" indicator
2. Create a group trip with 3 members → member avatars display
3. Edit trip title/destination → changes reflected everywhere
4. Delete trip → confirmation modal → trip removed
5. Trip status auto-transitions based on dates
6. Filter chips work (All / Upcoming / Active / Completed)
7. Dashboard shows active trip widget
8. Real-time: create trip on another device → appears on this device
9. Offline: kill network → trip data still loads from local store
