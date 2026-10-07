import * as BackgroundTask from "expo-background-task";
import * as Location from "expo-location";
import { defineTask, isTaskRegisteredAsync } from "expo-task-manager";
import { ACCURACY, toPosition, type LocationAccuracy, type Position } from "./position";

export interface BackgroundUpdateOptions {
  accuracy: LocationAccuracy;
  /** Minimum ms between updates. */
  timeInterval: number;
  /** Minimum metres moved between updates. */
  distanceInterval: number;
  /** Batches fixes so the task wakes about once per this many ms. */
  deferredUpdatesInterval?: number;
  /** Android foreground-service notification that keeps updates alive. */
  foregroundService: { title: string; body: string; killServiceOnDestroy: boolean };
  pausesUpdatesAutomatically: boolean;
  showsBackgroundLocationIndicator: boolean;
}

/**
 * Registers the handler for a background location task. Call at module scope from a file the
 * repo-root index.ts imports, so the task exists on a headless launch.
 */
export function defineLocationTask(name: string, onPositions: (positions: Position[]) => Promise<void>) {
  defineTask(name, async ({ data, error }) => {
    if (error) return;
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    if (!locations?.length) return;
    await onPositions(locations.map(toPosition));
  });
}

/** Starts (or restarts with new options) the OS location updates that feed the task. */
export function startLocationUpdates(name: string, options: BackgroundUpdateOptions): Promise<void> {
  return Location.startLocationUpdatesAsync(name, {
    accuracy: ACCURACY[options.accuracy],
    timeInterval: options.timeInterval,
    distanceInterval: options.distanceInterval,
    deferredUpdatesInterval: options.deferredUpdatesInterval,
    activityType: Location.ActivityType.Other,
    foregroundService: {
      notificationTitle: options.foregroundService.title,
      notificationBody: options.foregroundService.body,
      killServiceOnDestroy: options.foregroundService.killServiceOnDestroy,
    },
    pausesUpdatesAutomatically: options.pausesUpdatesAutomatically,
    showsBackgroundLocationIndicator: options.showsBackgroundLocationIndicator,
  });
}

export function stopLocationUpdates(name: string): Promise<void> {
  return Location.stopLocationUpdatesAsync(name);
}

export function hasStartedLocationUpdates(name: string): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(name);
}

export interface GeofenceRegion {
  latitude: number;
  longitude: number;
  radius: number;
}

/**
 * Registers the handler for a geofencing task that reports leaving a region. Define it at module
 * scope like defineLocationTask. Needs "Allow all the time" location, which background updates
 * already require.
 */
export function defineGeofenceExitTask(name: string, onExit: () => Promise<void>) {
  defineTask(name, async ({ data, error }) => {
    if (error) return;
    const eventType = (data as { eventType?: Location.GeofencingEventType } | undefined)?.eventType;
    if (eventType === Location.GeofencingEventType.Exit) await onExit();
  });
}

/** Watches one region (replacing any the task watched before) and wakes the task when the phone leaves it. */
export function startGeofence(name: string, region: GeofenceRegion): Promise<void> {
  return Location.startGeofencingAsync(name, [
    { identifier: name, ...region, notifyOnEnter: false, notifyOnExit: true },
  ]);
}

export async function stopGeofence(name: string): Promise<void> {
  if (await Location.hasStartedGeofencingAsync(name)) await Location.stopGeofencingAsync(name);
}

/**
 * Registers the handler for an OS-scheduled task (Android WorkManager, iOS BGTaskScheduler) that
 * runs about every `registerPeriodicTask` interval while registered, even with no location fix.
 */
export function definePeriodicTask(name: string, run: () => Promise<void>) {
  defineTask(name, async () => {
    try {
      await run();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** The OS treats the interval as a minimum (15 min at least) and may run it later. Never throws. */
export async function registerPeriodicTask(name: string, minutes: number): Promise<void> {
  try {
    if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    if (!(await isTaskRegisteredAsync(name))) await BackgroundTask.registerTaskAsync(name, { minimumInterval: minutes });
  } catch {}
}

export async function unregisterPeriodicTask(name: string): Promise<void> {
  try {
    if (await isTaskRegisteredAsync(name)) await BackgroundTask.unregisterTaskAsync(name);
  } catch {}
}
