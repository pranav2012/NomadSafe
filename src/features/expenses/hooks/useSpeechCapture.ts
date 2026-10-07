import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import { getLocales } from "expo-localization";
import { useSharedValue } from "react-native-reanimated";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { logger } from "@/modules/logger";
import { withSystemPrompt } from "@/utils/systemPrompt";

export type SpeechUnavailableReason =
  | "unsupported"
  | "permission"
  | "language-missing"
  | "no-speech"
  | "failed";

export type SpeechCaptureState =
  | { status: "idle" }
  | { status: "listening"; partial: string }
  | { status: "unavailable"; reason: SpeechUnavailableReason; locale?: string };

const MIN_ANDROID_ON_DEVICE_API = 33;

function deviceLocaleTag(): string {
  return getLocales()[0]?.languageTag ?? "en-US";
}

function sameLanguage(a: string, b: string): boolean {
  return a.split(/[-_]/)[0].toLowerCase() === b.split(/[-_]/)[0].toLowerCase();
}

/** Picks an on-device recognition locale; fails rather than fall back to network recognition. */
async function resolveOfflineLocale(): Promise<
  { ok: true; locale: string } | { ok: false; reason: SpeechUnavailableReason; locale?: string }
> {
  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return { ok: false, reason: "unsupported" };
  const device = deviceLocaleTag();

  if (Platform.OS === "ios") {
    // iOS reports on-device support only for the device-locale recognizer, so use exactly that locale.
    return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()
      ? { ok: true, locale: device }
      : { ok: false, reason: "unsupported" };
  }

  if (Number(Platform.Version) < MIN_ANDROID_ON_DEVICE_API || !ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
    return { ok: false, reason: "unsupported" };
  }
  const { locales, installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
  const installed =
    installedLocales.find((locale) => locale.toLowerCase() === device.toLowerCase()) ??
    installedLocales.find((locale) => sameLanguage(locale, device)) ??
    installedLocales.find((locale) => sameLanguage(locale, "en"));
  if (installed) return { ok: true, locale: installed };
  const downloadable =
    locales.find((locale) => locale.toLowerCase() === device.toLowerCase()) ??
    locales.find((locale) => sameLanguage(locale, device)) ??
    "en-US";
  return { ok: false, reason: "language-missing", locale: downloadable };
}

/** On-device speech capture for one utterance; `onFinal` gets the transcript. */
export function useSpeechCapture({
  onFinal,
  contextualStrings,
}: {
  onFinal: (transcript: string) => void;
  contextualStrings: string[];
}) {
  const [state, setState] = useState<SpeechCaptureState>({ status: "idle" });
  // Mic level arrives ~8 times a second; a shared value feeds the orb without re-rendering the screen.
  const volume = useSharedValue(0);
  const transcriptRef = useRef("");
  const deliveredRef = useRef(false);

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim() ?? "";
    transcriptRef.current = transcript;
    if (event.isFinal) {
      if (transcript && !deliveredRef.current) {
        deliveredRef.current = true;
        setState({ status: "idle" });
        onFinal(transcript);
      }
    } else {
      setState({ status: "listening", partial: transcript });
    }
  });

  useSpeechRecognitionEvent("volumechange", (event) => volume.set(Math.max(0, event.value)));

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted") return;
    const code = String(event.error);
    logger.warn("speechCapture", "recognition error", { code });
    const reason: SpeechUnavailableReason =
      code === "no-speech" || code === "speech-timeout"
        ? "no-speech"
        : code === "not-allowed"
          ? "permission"
          : code === "language-not-supported"
            ? "language-missing"
            : "failed";
    setState({ status: "unavailable", reason, locale: deviceLocaleTag() });
  });

  useSpeechRecognitionEvent("end", () => {
    // Some recognizers end without a final flag; deliver the last partial instead.
    const transcript = transcriptRef.current;
    if (!deliveredRef.current && transcript) {
      deliveredRef.current = true;
      onFinal(transcript);
    }
    setState((current) => (current.status === "listening" ? { status: "idle" } : current));
    volume.set(0);
  });

  const start = useCallback(async () => {
    transcriptRef.current = "";
    deliveredRef.current = false;
    const permission = await withSystemPrompt(() => ExpoSpeechRecognitionModule.requestPermissionsAsync());
    if (!permission.granted) {
      setState({ status: "unavailable", reason: "permission" });
      return;
    }
    const resolved = await resolveOfflineLocale().catch((error: unknown) => {
      logger.warn("speechCapture", "locale lookup failed", error);
      return { ok: false as const, reason: "failed" as const, locale: undefined };
    });
    if (!resolved.ok) {
      setState({ status: "unavailable", reason: resolved.reason, locale: resolved.locale });
      return;
    }
    setState({ status: "listening", partial: "" });
    ExpoSpeechRecognitionModule.start({
      lang: resolved.locale,
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      requiresOnDeviceRecognition: true,
      addsPunctuation: false,
      contextualStrings,
      iosTaskHint: "dictation",
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      androidIntentOptions: {
        EXTRA_PREFER_OFFLINE: true,
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1800,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1500,
      },
    });
  }, [contextualStrings]);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);
  const cancel = useCallback(() => {
    deliveredRef.current = true;
    ExpoSpeechRecognitionModule.abort();
    setState({ status: "idle" });
  }, []);

  const downloadLanguage = useCallback(async (locale: string) => {
    try {
      const result = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale });
      return result.status;
    } catch (error) {
      logger.warn("speechCapture", "language download failed", error);
      return null;
    }
  }, []);

  return { state, volume, start, stop, cancel, downloadLanguage };
}
