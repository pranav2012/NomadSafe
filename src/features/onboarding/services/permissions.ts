import * as Contacts from "expo-contacts";
import { getForegroundPermission, requestForegroundPermission } from "@/modules/location";
import { logger } from "@/modules/logger";
import { notifications as notificationService } from "@/modules/notifications";
import { withSystemPrompt } from "@/utils/systemPrompt";

export type PermissionKind = "location" | "contacts" | "notifications";

export interface PermissionStatus {
  kind: PermissionKind;
  granted: boolean;
  canAskAgain: boolean;
  denied: boolean;
}

interface RawPermission {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

function toStatus(kind: PermissionKind, raw: RawPermission): PermissionStatus {
  return {
    kind,
    granted: raw.granted,
    canAskAgain: raw.canAskAgain,
    denied: raw.status === "denied",
  };
}

/** Never throws: a failed permission call is reported as not granted. */
async function safely(
  kind: PermissionKind,
  call: () => Promise<RawPermission>,
): Promise<PermissionStatus> {
  try {
    return toStatus(kind, await call());
  } catch (err) {
    logger.warn("permissions", "check failed", err, { kind });
    return { kind, granted: false, canAskAgain: true, denied: false };
  }
}

// Foreground location only; background is requested from Sharing after its disclosure.
export const permissionsService = {
  async checkAll(): Promise<Record<PermissionKind, PermissionStatus>> {
    const [location, contacts, notifications] = await Promise.all([
      safely("location", () => getForegroundPermission()),
      safely("contacts", () => Contacts.getPermissionsAsync()),
      safely("notifications", () => notificationService.getPermission()),
    ]);
    return { location, contacts, notifications };
  },

  requestLocation(): Promise<PermissionStatus> {
    return safely("location", () => requestForegroundPermission());
  },

  requestContacts(): Promise<PermissionStatus> {
    return safely("contacts", () => withSystemPrompt(() => Contacts.requestPermissionsAsync()));
  },

  requestNotifications(): Promise<PermissionStatus> {
    return safely("notifications", async () => {
      const current = await notificationService.getPermission();
      if (current.granted || !current.canAskAgain) return current;
      return notificationService.requestPermission();
    });
  },
};
