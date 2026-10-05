import { Platform } from "react-native";
import Constants from "expo-constants";
import { logger } from "@/modules/logger";

type AppCheckSdk = typeof import("@react-native-firebase/app-check");
type FirebaseAppSdk = typeof import("@react-native-firebase/app");
type AppCheck = import("@react-native-firebase/app-check").AppCheck;

const TOKEN_TIMEOUT_MS = 5_000;
// Development builds use the debug provider; register the token in the Firebase console.
const debugToken = __DEV__ ? process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN || undefined : undefined;

let instance: Promise<AppCheck | null> | null = null;
let warned = false;

/** iOS links Firebase only once `ios.googleServicesFile` is configured (see react-native.config.js). */
function isSupported() {
  if (Platform.OS === "android") return true;
  return Platform.OS === "ios" && Boolean(Constants.expoConfig?.ios?.googleServicesFile);
}

function warnOnce(message: string, error?: unknown) {
  if (warned) return;
  warned = true;
  logger.warn("appCheck", message, error);
}

/** Configures App Check once: Play Integrity on Android, App Attest (DeviceCheck fallback) on iOS. */
function appCheck(): Promise<AppCheck | null> {
  instance ??= (async () => {
    if (!isSupported()) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getApp } = require("@react-native-firebase/app") as FirebaseAppSdk;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdk = require("@react-native-firebase/app-check") as AppCheckSdk;
      const provider = new sdk.ReactNativeFirebaseAppCheckProvider();
      provider.configure({
        android: { provider: __DEV__ ? "debug" : "playIntegrity", debugToken },
        apple: { provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback", debugToken },
      });
      // No auto-refresh: tokens are fetched on demand, which keeps Play Integrity calls down.
      return sdk.initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: false });
    } catch (error) {
      warnOnce("init failed", error);
      return null;
    }
  })();
  return instance;
}

/**
 * An App Check token for billed backend calls, cached and refreshed by the SDK. Undefined when App
 * Check is unsupported or fails; never throws, so callers send the request without it.
 */
export async function getAppCheckToken(): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const checker = await appCheck();
    if (!checker) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getToken } = require("@react-native-firebase/app-check") as AppCheckSdk;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS);
    });
    const result = await Promise.race([getToken(checker, false), timeout]);
    if (!result) warnOnce("token timed out");
    return result?.token || undefined;
  } catch (error) {
    warnOnce("token unavailable", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Adds `appCheckToken` to a backend action's arguments when one is available. */
export async function withAppCheck<T extends object>(args: T): Promise<T & { appCheckToken?: string }> {
  const appCheckToken = await getAppCheckToken();
  return appCheckToken ? { ...args, appCheckToken } : args;
}
