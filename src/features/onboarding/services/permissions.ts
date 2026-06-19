import { Platform } from "react-native";
import * as Location from "expo-location";
import * as Contacts from "expo-contacts";
import * as SMS from "expo-sms";

export type PermissionKind = "location" | "locationAlways" | "contacts" | "sms";

export interface PermissionStatus {
  kind: PermissionKind;
  granted: boolean;
  canAskAgain: boolean;
  denied: boolean;
}

async function getLocationStatus(): Promise<PermissionStatus> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    return {
      kind: "location",
      granted: false,
      canAskAgain: foreground.canAskAgain,
      denied: foreground.status === Location.PermissionStatus.DENIED,
    };
  }
  const background = await Location.getBackgroundPermissionsAsync();
  return {
    kind: "locationAlways",
    granted: background.granted,
    canAskAgain: background.canAskAgain,
    denied: background.status === Location.PermissionStatus.DENIED,
  };
}

async function getContactsStatus(): Promise<PermissionStatus> {
  const status = await Contacts.getPermissionsAsync();
  return {
    kind: "contacts",
    granted: status.granted,
    canAskAgain: status.canAskAgain,
    denied: status.status === Contacts.PermissionStatus.DENIED,
  };
}

async function getSmsStatus(): Promise<PermissionStatus> {
  const isAvailable = await SMS.isAvailableAsync();
  return {
    kind: "sms",
    granted: isAvailable,
    canAskAgain: false,
    denied: !isAvailable,
  };
}

export const permissionsService = {
  async checkAll(): Promise<Record<PermissionKind, PermissionStatus>> {
    const [location, contacts, sms] = await Promise.all([
      getLocationStatus(),
      getContactsStatus(),
      getSmsStatus(),
    ]);
    return {
      location,
      locationAlways: location,
      contacts,
      sms,
    };
  },

  async requestLocation(): Promise<PermissionStatus> {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) {
      return {
        kind: "location",
        granted: false,
        canAskAgain: foreground.canAskAgain,
        denied: foreground.status === Location.PermissionStatus.DENIED,
      };
    }
    if (Platform.OS === "android") {
      const background = await Location.requestBackgroundPermissionsAsync();
      return {
        kind: "locationAlways",
        granted: background.granted,
        canAskAgain: background.canAskAgain,
        denied: background.status === Location.PermissionStatus.DENIED,
      };
    }
    return {
      kind: "locationAlways",
      granted: true,
      canAskAgain: true,
      denied: false,
    };
  },

  async requestContacts(): Promise<PermissionStatus> {
    const status = await Contacts.requestPermissionsAsync();
    return {
      kind: "contacts",
      granted: status.granted,
      canAskAgain: status.canAskAgain,
      denied: status.status === Contacts.PermissionStatus.DENIED,
    };
  },

  async requestSms(): Promise<PermissionStatus> {
    const isAvailable = await SMS.isAvailableAsync();
    return {
      kind: "sms",
      granted: isAvailable,
      canAskAgain: false,
      denied: !isAvailable,
    };
  },
};
