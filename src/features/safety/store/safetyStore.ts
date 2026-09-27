import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import { cancelCheckInNotifications } from "../services/checkInNotifications";
import type { BroadcastSnapshot, SmsOutcome } from "../services/sosService";

export type SafetyStatus = "idle" | "active" | "emergency";

export interface SafetyEvent {
  id: string;
  dateIso: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  /** Legacy pre-localized message (events persisted before messageKey existed). */
  message?: string;
  timeLabel?: string;
  dayLabel?: string;
  icon: "check" | "bell" | "mapPin" | "shield";
  color: "teal" | "mustard" | "sky" | "stamp";
}

export interface SafetyTrustedContact {
  id: string;
  name: string;
  relation?: string;
  color?: string;
}

export interface SmsDelivery {
  outcome: SmsOutcome;
  recipients: number;
  hasLocation: boolean;
  at: number;
}

/** "needsSetup": not started because it would need a permission prompt mid-SOS. */
export type BroadcastOutcome = "starting" | "started" | "denied" | "failed" | "needsSetup";

interface SafetyState {
  status: SafetyStatus;
  checkInDuration: number;
  checkInEndsAt: number | null;
  extendedAt: number | null;
  missedLoggedFor: number | null;
  missedAlert: (SmsDelivery & { endsAt: number }) | null;
  events: SafetyEvent[];
  trustedContacts: SafetyTrustedContact[];
  lastTriggeredAt: number | null;
  sosDelivery: SmsDelivery | null;
  sosBroadcast: BroadcastOutcome | null;
  previousBroadcast: BroadcastSnapshot | null;

  startTimer: (durationSeconds?: number) => void;
  extendTimer: (extraSeconds: number) => void;
  stopTimer: () => void;
  markCheckInMissed: () => void;
  recordMissedAlert: (delivery: SmsDelivery) => void;
  triggerSos: (previousBroadcast: BroadcastSnapshot | null) => void;
  recordSosDelivery: (delivery: SmsDelivery) => void;
  recordSosBroadcast: (outcome: BroadcastOutcome) => void;
  cancelSos: () => void;
  addEvent: (event: Omit<SafetyEvent, "id" | "dateIso">) => void;
  setTrustedContacts: (contacts: SafetyTrustedContact[]) => void;
  reset: () => void;
}

const DEFAULT_DURATION = 2 * 60 * 60; // 2 hours

function makeEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const SOS_SMS_EVENT: Record<SmsOutcome, { key: string; color: SafetyEvent["color"] }> = {
  sent: { key: "safety.eventSosSmsSent", color: "stamp" },
  opened: { key: "safety.eventSosSmsOpened", color: "stamp" },
  cancelled: { key: "safety.eventSosSmsCancelled", color: "mustard" },
  failed: { key: "safety.eventSosSmsFailed", color: "mustard" },
};

const MISSED_SMS_EVENT: Record<SmsOutcome, { key: string; color: SafetyEvent["color"] }> = {
  sent: { key: "safety.eventMissedAlertSent", color: "stamp" },
  opened: { key: "safety.eventMissedAlertOpened", color: "stamp" },
  cancelled: { key: "safety.eventMissedAlertCancelled", color: "mustard" },
  failed: { key: "safety.eventMissedAlertFailed", color: "mustard" },
};

export function isCheckInMissed(state: Pick<SafetyState, "status" | "checkInEndsAt">, now = Date.now()) {
  return state.status === "active" && state.checkInEndsAt != null && state.checkInEndsAt <= now;
}

export const useSafetyStore = create<SafetyState>()(
  persist(
    (set, get) => ({
      status: "idle",
      checkInDuration: DEFAULT_DURATION,
      checkInEndsAt: null,
      extendedAt: null,
      missedLoggedFor: null,
      missedAlert: null,
      events: [],
      trustedContacts: [],
      lastTriggeredAt: null,
      sosDelivery: null,
      sosBroadcast: null,
      previousBroadcast: null,

      startTimer: (durationSeconds) => {
        const duration = durationSeconds ?? DEFAULT_DURATION;
        const endsAt = Date.now() + duration * 1000;
        set({
          status: "active",
          checkInDuration: duration,
          checkInEndsAt: endsAt,
          extendedAt: null,
          missedLoggedFor: null,
          missedAlert: null,
        });
        get().addEvent({
          messageKey: "safety.eventCheckInStarted",
          messageParams: { minutes: Math.round(duration / 60) },
          icon: "bell",
          color: "sky",
        });
      },

      extendTimer: (extraSeconds) => {
        const state = get();
        if (state.status !== "active" || !state.checkInEndsAt) return;
        // Extending an overdue timer counts from now, not from the missed deadline.
        const base = Math.max(state.checkInEndsAt, Date.now());
        set({
          checkInEndsAt: base + extraSeconds * 1000,
          extendedAt: Date.now(),
          missedLoggedFor: null,
          missedAlert: null,
        });
        get().addEvent({
          messageKey: "safety.eventCheckInExtended",
          messageParams: { minutes: Math.round(extraSeconds / 60) },
          icon: "bell",
          color: "sky",
        });
      },

      stopTimer: () => {
        const state = get();
        if (state.status !== "active") return;
        const late = isCheckInMissed(state);
        set({ status: "idle", checkInEndsAt: null, extendedAt: null, missedLoggedFor: null, missedAlert: null });
        void cancelCheckInNotifications();
        get().addEvent({
          messageKey: late ? "safety.eventCheckInCompletedLate" : "safety.eventCheckInCompleted",
          icon: "check",
          color: "teal",
        });
      },

      markCheckInMissed: () => {
        const state = get();
        if (!isCheckInMissed(state) || state.missedLoggedFor === state.checkInEndsAt) return;
        set({ missedLoggedFor: state.checkInEndsAt });
        get().addEvent({ messageKey: "safety.eventCheckInMissed", icon: "bell", color: "stamp" });
      },

      recordMissedAlert: (delivery) => {
        const endsAt = get().checkInEndsAt ?? Date.now();
        set({ missedAlert: { ...delivery, endsAt } });
        const meta = MISSED_SMS_EVENT[delivery.outcome];
        get().addEvent({
          messageKey: meta.key,
          messageParams: { count: delivery.recipients },
          icon: "bell",
          color: meta.color,
        });
      },

      triggerSos: (previousBroadcast) => {
        // SOS supersedes any running check-in.
        set({
          status: "emergency",
          lastTriggeredAt: Date.now(),
          checkInEndsAt: null,
          extendedAt: null,
          missedLoggedFor: null,
          missedAlert: null,
          sosDelivery: null,
          sosBroadcast: null,
          previousBroadcast,
        });
        void cancelCheckInNotifications();
        get().addEvent({ messageKey: "safety.eventSosTriggered", icon: "shield", color: "stamp" });
      },

      recordSosDelivery: (delivery) => {
        set({ sosDelivery: delivery });
        const meta = SOS_SMS_EVENT[delivery.outcome];
        get().addEvent({
          messageKey: meta.key,
          messageParams: { count: delivery.recipients },
          icon: "shield",
          color: meta.color,
        });
      },

      recordSosBroadcast: (outcome) => {
        set({ sosBroadcast: outcome });
        if (outcome === "starting" || outcome === "needsSetup") return;
        get().addEvent({
          messageKey: outcome === "started" ? "safety.eventBroadcastStarted" : "safety.eventBroadcastFailed",
          icon: "mapPin",
          color: outcome === "started" ? "sky" : "mustard",
        });
      },

      cancelSos: () => {
        set({
          status: "idle",
          lastTriggeredAt: null,
          sosDelivery: null,
          sosBroadcast: null,
          previousBroadcast: null,
        });
        get().addEvent({ messageKey: "safety.eventSosCancelled", icon: "check", color: "teal" });
      },

      addEvent: (event) => {
        const item: SafetyEvent = { id: makeEventId(), dateIso: new Date().toISOString(), ...event };
        set((state) => ({
          events: [item, ...state.events].slice(0, 50),
        }));
      },

      setTrustedContacts: (contacts) => {
        set({ trustedContacts: contacts });
      },

      reset: () => {
        void cancelCheckInNotifications();
        set({
          status: "idle",
          checkInDuration: DEFAULT_DURATION,
          checkInEndsAt: null,
          extendedAt: null,
          missedLoggedFor: null,
          missedAlert: null,
          events: [],
          trustedContacts: [],
          lastTriggeredAt: null,
          sosDelivery: null,
          sosBroadcast: null,
          previousBroadcast: null,
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
