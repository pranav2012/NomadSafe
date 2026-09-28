import { useEffect, useState } from "react";
import PostHog, { type PostHogCustomStorage } from "posthog-react-native";
import { storage } from "@/stores/storage";

type ExpenseSourceKind = "manual" | "paste" | "gmail" | "gmail_auto";
type SmsResult = "sent" | "cancelled" | "opened" | "failed";

/** Custom events. Properties are counts, enums and booleans only, never user content. */
export interface AnalyticsEvents {
  onboarding_completed: undefined;
  sign_in_started: undefined;
  sign_in_failed: undefined;
  trip_created: { mode: "solo" | "group"; destinations: number; has_budget: boolean };
  expense_added: { source: ExpenseSourceKind; count: number };
  live_share_started: { mode: string; recipients: number };
  live_share_stopped: undefined;
  check_in_started: { duration_minutes: number };
  check_in_completed: undefined;
  sos_triggered: { contacts: number };
  sos_sms_result: { outcome: SmsResult; has_location: boolean };
  sos_cancelled: undefined;
  ai_message_sent: { quick_question: boolean };
}

export interface FeatureFlags {
  example_flag: boolean;
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
        },
        errorTracking: { autocapture: false },
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        disableSurveys: true,
        before_send: (event) => {
          if (!event?.properties) return event;
          for (const key of URL_PROPERTIES) delete event.properties[key];
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

/** Starts or stops session replay, serialised so rapid lock/unlock can't reorder calls. */
export function setReplayRecording(record: boolean) {
  const client = posthog;
  if (!client) return;
  replayQueue = replayQueue.then(async () => {
    if (record === replayRecording) return;
    replayRecording = record;
    try {
      if (record) await client.startSessionRecording(true);
      else await client.stopSessionRecording();
    } catch {}
  });
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
