import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";

export type SafetyStatus = "idle" | "active" | "emergency";

export interface SafetyEvent {
  id: string;
  dateIso: string;
  timeLabel: string;
  dayLabel: string;
  message: string;
  icon: "check" | "bell" | "mapPin" | "shield";
  color: "teal" | "mustard" | "sky" | "stamp";
}

export interface SafetyTrustedContact {
  id: string;
  name: string;
  relation?: string;
  color?: string;
}

interface SafetyState {
  status: SafetyStatus;
  checkInDuration: number;
  checkInEndsAt: number | null;
  extendedAt: number | null;
  events: SafetyEvent[];
  trustedContacts: SafetyTrustedContact[];
  lastTriggeredAt: number | null;

  startTimer: (durationSeconds?: number) => void;
  extendTimer: (extraSeconds: number) => void;
  stopTimer: () => void;
  triggerSos: () => void;
  cancelSos: () => void;
  addEvent: (event: Omit<SafetyEvent, "id">) => void;
  setTrustedContacts: (contacts: SafetyTrustedContact[]) => void;
  reset: () => void;
}

const DEFAULT_DURATION = 2 * 60 * 60; // 2 hours

function makeEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useSafetyStore = create<SafetyState>()(
  persist(
    (set, get) => ({
      status: "idle",
      checkInDuration: DEFAULT_DURATION,
      checkInEndsAt: null,
      extendedAt: null,
      events: [],
      trustedContacts: [],
      lastTriggeredAt: null,

      startTimer: (durationSeconds) => {
        const duration = durationSeconds ?? DEFAULT_DURATION;
        const endsAt = Date.now() + duration * 1000;
        set({
          status: "active",
          checkInDuration: duration,
          checkInEndsAt: endsAt,
          extendedAt: null,
        });
      },

      extendTimer: (extraSeconds) => {
        const state = get();
        if (state.status !== "active" || !state.checkInEndsAt) return;
        const newEndsAt = state.checkInEndsAt + extraSeconds * 1000;
        set({
          checkInEndsAt: newEndsAt,
          extendedAt: Date.now(),
        });
      },

      stopTimer: () => {
        const state = get();
        if (state.status === "active") {
          set({ status: "idle", checkInEndsAt: null, extendedAt: null });
          get().addEvent({
            dateIso: new Date().toISOString(),
            timeLabel: formatTime(new Date()),
            dayLabel: "today",
            message: "Check-in completed · timer stopped",
            icon: "check",
            color: "teal",
          });
        }
      },

      triggerSos: () => {
        set({ status: "emergency", lastTriggeredAt: Date.now() });
        get().addEvent({
          dateIso: new Date().toISOString(),
          timeLabel: formatTime(new Date()),
          dayLabel: "today",
          message: "SOS triggered · location broadcast started",
          icon: "shield",
          color: "stamp",
        });
      },

      cancelSos: () => {
        set({ status: "idle", lastTriggeredAt: null });
        get().addEvent({
          dateIso: new Date().toISOString(),
          timeLabel: formatTime(new Date()),
          dayLabel: "today",
          message: "SOS cancelled · I'm safe",
          icon: "check",
          color: "teal",
        });
      },

      addEvent: (event) => {
        const item: SafetyEvent = { id: makeEventId(), ...event };
        set((state) => ({
          events: [item, ...state.events].slice(0, 50),
        }));
      },

      setTrustedContacts: (contacts) => {
        set({ trustedContacts: contacts });
      },

      reset: () => {
        set({
          status: "idle",
          checkInDuration: DEFAULT_DURATION,
          checkInEndsAt: null,
          extendedAt: null,
          events: [],
          trustedContacts: [],
          lastTriggeredAt: null,
        });
      },
    }),
    {
      name: "safety-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
    },
  ),
);

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
