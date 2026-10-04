import * as Location from "expo-location";

export type LocationPermissionStatus = "granted" | "denied" | "undetermined";

export interface LocationPermission {
  status: LocationPermissionStatus;
  granted: boolean;
  /** Whether the OS will still show a prompt. */
  canAskAgain: boolean;
}

function toPermission(raw: Location.LocationPermissionResponse): LocationPermission {
  return { status: raw.status as LocationPermissionStatus, granted: raw.granted, canAskAgain: raw.canAskAgain };
}

/** "While using the app" permission, without prompting. These all throw if the OS call fails. */
export async function getForegroundPermission(): Promise<LocationPermission> {
  return toPermission(await Location.getForegroundPermissionsAsync());
}

export async function requestForegroundPermission(): Promise<LocationPermission> {
  return toPermission(await Location.requestForegroundPermissionsAsync());
}

/** "Allow all the time" permission, without prompting. */
export async function getBackgroundPermission(): Promise<LocationPermission> {
  return toPermission(await Location.getBackgroundPermissionsAsync());
}

/** Prompts for "Allow all the time". Callers must show BackgroundLocationDisclosure first (Play policy). */
export async function requestBackgroundPermission(): Promise<LocationPermission> {
  return toPermission(await Location.requestBackgroundPermissionsAsync());
}
