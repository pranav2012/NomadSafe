import * as Location from "expo-location";
import * as Contacts from "expo-contacts";
import * as Notifications from "expo-notifications";

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
    console.warn(`[permissions] ${kind} check failed`, err);
    return { kind, granted: false, canAskAgain: true, denied: false };
  }
}

// Foreground location only; background is requested from Sharing after its disclosure.
export const permissionsService = {
  async checkAll(): Promise<Record<PermissionKind, PermissionStatus>> {
    const [location, contacts, notifications] = await Promise.all([
      safely("location", () => Location.getForegroundPermissionsAsync()),
      safely("contacts", () => Contacts.getPermissionsAsync()),
      safely("notifications", () => Notifications.getPermissionsAsync()),
    ]);
    return { location, contacts, notifications };
  },

  requestLocation(): Promise<PermissionStatus> {
    return safely("location", () => Location.requestForegroundPermissionsAsync());
  },

  requestContacts(): Promise<PermissionStatus> {
    return safely("contacts", () => Contacts.requestPermissionsAsync());
  },

  requestNotifications(): Promise<PermissionStatus> {
    return safely("notifications", async () => {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted || !current.canAskAgain) return current;
      return Notifications.requestPermissionsAsync();
    });
  },
};
