import { useEffect, useState } from "react";
import Constants from "expo-constants";
import PostHog, { type PostHogCustomStorage } from "posthog-react-native";
import type { AdPlacement } from "@/modules/ads";
import { scrubErrorMessage } from "@/modules/logger";
import { storage } from "@/modules/storage";

type ExpenseSourceKind = "manual" | "paste" | "gmail" | "gmail_auto" | "voice";
type VoiceCaptureFailure = "no_model" | "speech_unavailable" | "unclear" | "model_error";
type SmsResult = "sent" | "cancelled" | "opened" | "failed";
type PaidTier = "plus" | "pro";
type BillingPeriod = "monthly" | "annual" | "lifetime";
type AiProvider = "local" | "cloud" | "byok";
type AiTask = "chat" | "budget" | "trip_name" | "itinerary" | "voice" | "receipt";
type HomeStage = "none" | "upcoming" | "eve" | "active" | "ended";
type EventSource = "manual" | "email";

/** Custom events. Properties are counts, enums and booleans only, never user content. */
export interface AnalyticsEvents {
  onboarding_completed: undefined;
  sign_in_started: undefined;
  sign_in_failed: undefined;
  trip_created: { mode: "solo" | "group"; destinations: number; has_budget: boolean };
  planned_trip: { action: "created" | "confirmed" | "discarded"; destinations?: number; had_month?: boolean; ideas?: number; at_trip_limit?: boolean };
  group_created: { people: number };
  ai_context_picked: { kind: "trip" | "group" | "overview" | "general" };
  home_card_opened: { card: "balance" | "get_home_safe" };
  app_landing: { tab: "home" | "money" | "other"; reason: "trip" | "habit" | "link" };
  recurring_added: { count: number };
  recurring_created: { frequency: "weekly" | "monthly" | "yearly" };
  money_exported: { format: "csv" | "pdf"; count: number };
  receipt_scanned: { found_total: boolean; lines: number };
  receipt_items_split: { items: number; people: number };
  app_import_completed: { source: "splitwise" | "settleup"; mode: "history" | "balances"; expenses: number; payments: number };
  group_archived: { archived: boolean; kind: "trip" | "group" };
  smart_split_changed: { on: boolean };
  plus_feature_blocked: { feature: "shares" | "presets" | "recurring" | "charts" | "export" | "receiptScan" };
  trip_joined: { deferred: boolean; claimed_member: boolean };
  invite_deferred_found: { source: "install_referrer" | "clipboard" };
  expense_added: { source: ExpenseSourceKind; count: number };
  live_share_started: { mode: string; recipients: number };
  live_share_stopped: undefined;
  check_in_started: { duration_minutes: number };
  check_in_completed: undefined;
  sos_triggered: { contacts: number; app_contacts: number; from_widget: boolean };
  sos_sms_result: { outcome: SmsResult; has_location: boolean };
  sos_cancelled: undefined;
  location_coords_action: { action: "share" | "copy" | "maps" };
  ai_message_sent: undefined;
  ai_chat_cleared: { temporary: boolean };
  ai_temporary_chat_started: undefined;
  settlement_recorded: { source: "manual" | "voice" };
  voice_capture_opened: { from_widget: boolean; locked: boolean };
  voice_capture_failed: { reason: VoiceCaptureFailure };
  voice_draft_saved: { kind: "expense" | "settlement"; split: boolean; edited: boolean; auto: boolean };
  trip_limit_reached: undefined;
  group_limit_reached: undefined;
  planned_trip_limit_reached: undefined;
  paywall_viewed: { reason: "trips" | "groups" | "planned" | "plus" | "ai" | "settings" };
  purchase_completed: { tier: PaidTier; period: BillingPeriod; trial: boolean };
  purchases_restored: { tier: "free" | PaidTier };
  ai_provider_used: { provider: AiProvider; task: AiTask; fallback: boolean };
  ai_key_saved: { provider: "openai" | "anthropic" | "gemini" | "openai_compatible" };
  ad_shown: { placement: AdPlacement };
  ad_failed: { placement: AdPlacement | "preload"; stage: "load" | "show" };
  home_viewed: { stage: HomeStage; events_today: number; trip_events: number };
  itinerary_sheet_opened: { events: number };
  itinerary_event_added: { source: "manual" | "gmail"; count: number };
  itinerary_event_edited: { source: EventSource };
  itinerary_event_deleted: { source: EventSource };
  itinerary_day_viewed: { relative_day: number };
  ticket_opened: { kind: "pdf" | "image"; count: number };
  ticket_added: { source: "gmail" | "file" | "photo" | "received"; count: number };
  must_do_suggestion: { action: "added" | "dismissed"; where: "free_day" | "trip_prep" | "day_ideas" | "saved_sheet" };
  saved_ideas_opened: { from: "prep" | "must_dos" | "day" | "header" | "toast"; ideas: number };
  saved_idea_action: { action: "planned" | "removed"; where: "saved_sheet" | "day_ideas" };
  today_action: { action: "maps" | "add_stop" | "expand_globe" | "collapse_globe" | "back_to_today" | "done" | "undone" | "ask_ticket" };
  recap_opened: { source: "home" | "notification" | "trips"; stops: number };
  recap_finished: { stops: number };
  recap_shared: { format: "image" | "video"; spend: boolean };
  passport_opened: { source: "trips" | "replay"; stamps: number };
  past_travel_added: { has_region: boolean; has_month: boolean };
  steps_linked: { source: "health_connect" | "apple_health" | "none"; granted: boolean };
  trip_photos_added: { count: number };
}

export interface FeatureFlags {
  example_flag: boolean;
  /** Payload overrides the ad frequency limits (`AdConfig` in `@/modules/ads`). */
  ad_frequency: boolean;
}

type EventArgs<K extends keyof AnalyticsEvents> = AnalyticsEvents[K] extends undefined
  ? []
  : [properties: AnalyticsEvents[K]];

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const STORAGE_PREFIX = "posthog:";

// Stored in the main encrypted MMKV so PostHog's IDs and queue aren't written in plain files.
const encryptedStorage: PostHogCustomStorage = {
  getItem: (key) => storage.getString(STORAGE_PREFIX + key) ?? null,
  setItem: (key, value) => storage.set(STORAGE_PREFIX + key, value),
};

// Deep links can carry invite tokens, so URLs never leave the device.
const URL_PROPERTIES = ["url", "$current_url", "$referring_link", "$deep_link_url"];

/** Scrubs exception messages (logger.error and autocaptured crashes) like log messages; stack frames stay. */
function scrubException(properties: Record<string, unknown>) {
  const list = properties.$exception_list;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item === "object" && typeof (item as { value?: unknown }).value === "string") {
        (item as { value: string }).value = scrubErrorMessage((item as { value: string }).value, 500);
      }
    }
  }
  for (const key of ["$exception_message", "$exception_values"]) {
    const value = properties[key];
    if (typeof value === "string") properties[key] = scrubErrorMessage(value, 500);
    else if (Array.isArray(value)) properties[key] = value.map((entry) => (typeof entry === "string" ? scrubErrorMessage(entry, 500) : entry));
  }
}

export const posthog: PostHog | null =
  apiKey && !__DEV__
    ? new PostHog(apiKey, {
        host: "https://eu.i.posthog.com",
        customStorage: encryptedStorage,
        personProfiles: "identified_only",
        captureAppLifecycleEvents: true,
        // Replay is started and stopped by setReplayRecording so it never runs during PIN entry.
        enableSessionReplay: false,
        sessionReplayConfig: {
          maskAllTextInputs: true,
          maskAllImages: true,
          maskAllSandboxedViews: true,
          captureLog: false,
          captureNetworkTelemetry: false,
          // Snapshots cost main-thread time and battery; one every 3 s is enough to follow a session.
          throttleDelayMs: 3000,
        },
        errorTracking: {
          autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
            nativeCrashes: true,
            androidNdkCrashes: true,
          },
        },
        logs: {
          serviceName: "nomadsafe-app",
          serviceVersion: Constants.expoConfig?.version,
          environment: "production",
        },
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        disableSurveys: true,
        before_send: (event) => {
          if (!event?.properties) return event;
          for (const key of URL_PROPERTIES) delete event.properties[key];
          if (event.event === "$exception") scrubException(event.properties);
          return event;
        },
      })
    : null;

export function track<K extends keyof AnalyticsEvents>(event: K, ...args: EventArgs<K>) {
  posthog?.capture(event, args[0]);
}

export function trackScreen(route: string) {
  void posthog?.screen(route);
}

export function identifyUser(userId: string) {
  posthog?.identify(userId);
}

export function resetAnalytics() {
  posthog?.reset();
}

export function setAnalyticsEnabled(enabled: boolean) {
  if (!posthog) return;
  if (enabled && posthog.optedOut) void posthog.optIn();
  else if (!enabled && !posthog.optedOut) void posthog.optOut();
}

let replayQueue = Promise.resolve();
let replayRecording = false;

// Replay records a sample of app launches rather than every session, decided once per launch.
const REPLAY_SAMPLE_RATE = 0.1;
const replaySampled = Math.random() < REPLAY_SAMPLE_RATE;

/** Starts or stops session replay, serialised so rapid lock/unlock can't reorder calls. */
export function setReplayRecording(record: boolean) {
  const client = posthog;
  if (!client || !replaySampled) return;
  replayQueue = replayQueue.then(async () => {
    if (record === replayRecording) return;
    replayRecording = record;
    try {
      if (record) await client.startSessionRecording(true);
      else await client.stopSessionRecording();
    } catch {}
  });
}

/** A flag's JSON payload, read synchronously from PostHog's cache; undefined when unset or offline. */
export function getFlagPayload(flag: keyof FeatureFlags): unknown {
  return posthog?.getFeatureFlagPayload(flag) ?? undefined;
}

export function useFlag<K extends keyof FeatureFlags>(flag: K): FeatureFlags[K] | undefined {
  const [value, setValue] = useState(() => posthog?.getFeatureFlag(flag) as FeatureFlags[K] | undefined);

  useEffect(() => {
    if (!posthog) return;
    const client = posthog;
    const read = () => setValue(client.getFeatureFlag(flag) as FeatureFlags[K] | undefined);
    read();
    return client.onFeatureFlags(read);
  }, [flag]);

  return value;
}

export { PrivateView } from "./PrivateView";
