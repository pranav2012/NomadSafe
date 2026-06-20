import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";

export type BroadcastMode = "normal" | "low" | "emergency";

export type RecipientLinkStatus =
  | "none"
  | "pending"
  | "accepted"
  | "declined"
  | "not_user";

export interface ShareRecipient {
  id: string;
  name: string;
  initial: string;
  color: string;
  phone?: string | null;
  email?: string | null;
  sharing: boolean;
  lastSeenAt: number | null;
  battery: number | null;
  distanceKm: number | null;
  linkStatus?: RecipientLinkStatus;
  linkedUserId?: string | null;
  convexLinkId?: string | null;
}

export interface Geofence {
  id: string;
  name: string;
  radiusM: number;
  notifyIds: string[];
  active: boolean;
  color: "teal" | "mustard" | "sky";
}

export interface SharingState {
  isBroadcasting: boolean;
  mode: BroadcastMode;
  lastPublishedAt: number | null;
  recipients: ShareRecipient[];
  geofences: Geofence[];
  currentBattery: number | null;

  setBroadcasting: (enabled: boolean) => void;
  setMode: (mode: BroadcastMode) => void;
  setCurrentBattery: (battery: number | null) => void;
  setLastPublishedAt: (timestamp: number | null) => void;
  addRecipient: (
    recipient: Omit<ShareRecipient, "id" | "battery" | "sharing" | "lastSeenAt" | "distanceKm" | "linkStatus" | "linkedUserId" | "convexLinkId">,
  ) => void;
  updateRecipient: (id: string, patch: Partial<ShareRecipient>) => void;
  removeRecipient: (id: string) => void;
  toggleRecipient: (id: string) => void;
  touchRecipient: (
    id: string,
    touch: {
      lastSeenAt?: number;
      battery?: number | null;
      distanceKm?: number | null;
    },
  ) => void;
  addGeofence: (geofence: Omit<Geofence, "id">) => void;
  updateGeofence: (id: string, patch: Partial<Geofence>) => void;
  removeGeofence: (id: string) => void;
  reset: () => void;
}

const DEFAULT_MODE: BroadcastMode = "normal";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useSharingStore = create<SharingState>()(
  persist(
    (set, get) => ({
      isBroadcasting: false,
      mode: DEFAULT_MODE,
      lastPublishedAt: null,
      recipients: [],
      geofences: [],
      currentBattery: null,

      setBroadcasting: (enabled) => {
        set({
          isBroadcasting: enabled,
          lastPublishedAt: enabled ? Date.now() : get().lastPublishedAt,
        });
      },

      setMode: (mode) => {
        set({ mode });
      },

      setCurrentBattery: (battery) => {
        set({ currentBattery: battery });
      },

      setLastPublishedAt: (timestamp) => {
        set({ lastPublishedAt: timestamp });
      },

      addRecipient: (recipient) => {
        const item: ShareRecipient = {
          ...recipient,
          id: makeId(),
          sharing: true,
          lastSeenAt: null,
          battery: null,
          distanceKm: null,
          linkStatus: "none",
          linkedUserId: null,
          convexLinkId: null,
        };
        set((state) => ({
          recipients: [...state.recipients, item],
        }));
      },

  updateRecipient: (id, patch) => {
    set((state) => ({
      recipients: state.recipients.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    }));
  },

  touchRecipient: (id, touch) => {
    set((state) => ({
      recipients: state.recipients.map((r) =>
        r.id === id
          ? {
              ...r,
              lastSeenAt: touch.lastSeenAt ?? Date.now(),
              battery:
                touch.battery !== undefined ? touch.battery : r.battery,
              distanceKm:
                touch.distanceKm !== undefined ? touch.distanceKm : r.distanceKm,
            }
          : r,
      ),
    }));
  },

      removeRecipient: (id) => {
        set((state) => ({
          recipients: state.recipients.filter((r) => r.id !== id),
        }));
      },

      toggleRecipient: (id) => {
        set((state) => ({
          recipients: state.recipients.map((r) =>
            r.id === id ? { ...r, sharing: !r.sharing } : r,
          ),
        }));
      },

      addGeofence: (geofence) => {
        const item: Geofence = { ...geofence, id: makeId() };
        set((state) => ({
          geofences: [...state.geofences, item],
        }));
      },

      updateGeofence: (id, patch) => {
        set((state) => ({
          geofences: state.geofences.map((g) =>
            g.id === id ? { ...g, ...patch } : g,
          ),
        }));
      },

      removeGeofence: (id) => {
        set((state) => ({
          geofences: state.geofences.filter((g) => g.id !== id),
        }));
      },

      reset: () => {
        set({
          isBroadcasting: false,
          mode: DEFAULT_MODE,
          lastPublishedAt: null,
          recipients: [],
          geofences: [],
          currentBattery: null,
        });
      },
    }),
    {
      name: "sharing-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
    },
  ),
);

export function getDrainPercentForMode(mode: BroadcastMode): number {
  switch (mode) {
    case "low":
      return 2.1;
    case "emergency":
      return 9.4;
    case "normal":
    default:
      return 4.3;
  }
}

export function getIntervalForMode(mode: BroadcastMode): number {
  switch (mode) {
    case "low":
      return 5 * 60; // 5 min
    case "emergency":
      return 15; // 15s
    case "normal":
    default:
      return 60; // 60s
  }
}
