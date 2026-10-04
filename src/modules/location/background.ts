import * as Location from "expo-location";
import { defineTask } from "expo-task-manager";
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
