import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { RawMessage } from "@/features/expenses/services/transactionParser";

interface NativeSms {
  body: string;
  date: number;
  address: string;
}

interface PermissionResponse {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

interface ExpoSmsReaderModule {
  getPermissionStatus(): "granted" | "denied" | "undetermined";
  requestPermission(): Promise<PermissionResponse>;
  readInbox(sinceEpochMs: number, limit: number): Promise<NativeSms[]>;
}

// Optional: present only in an Android dev/release build that bundles the
// local `expo-sms-reader` module. Absent in Expo Go and on iOS.
const SmsReader = requireOptionalNativeModule<ExpoSmsReaderModule>("ExpoSmsReader");

// Senders that send transaction alerts are usually short codes / bank IDs, not
// 10-digit phone numbers. Keep messages from non-personal senders only.
function isLikelyBankSender(address: string): boolean {
  const digitsOnly = address.replace(/\D/g, "");
  return digitsOnly.length === 0 || digitsOnly.length < 7 || /[A-Za-z]/.test(address);
}

export const smsImport = {
  /** True only on an Android build that includes the native SMS reader module. */
  isSupported(): boolean {
    return Platform.OS === "android" && SmsReader != null;
  },

  getPermissionStatus(): "granted" | "denied" | "undetermined" | "unsupported" {
    if (!SmsReader) return "unsupported";
    return SmsReader.getPermissionStatus();
  },

  async requestPermission(): Promise<boolean> {
    if (!SmsReader) return false;
    const response = await SmsReader.requestPermission();
    return response.granted;
  },

  /**
   * Reads recent inbox messages from likely bank/UPI senders for parsing.
   * Throws if the native module is unavailable so callers can guide the user to
   * paste alerts instead.
   */
  async readRecent(days = 30, limit = 300): Promise<RawMessage[]> {
    if (!SmsReader) {
      throw new Error("SMS reading is not available on this build.");
    }
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const messages = await SmsReader.readInbox(since, limit);
    return messages
      .filter((message) => isLikelyBankSender(message.address))
      .map((message) => ({
        body: message.body,
        date: new Date(message.date).toISOString(),
      }));
  },
};
