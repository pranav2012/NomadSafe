/** Public API of the location module: permissions, positions, geocoding, background updates and maps. */
export {
  getBackgroundPermission,
  getForegroundPermission,
  requestBackgroundPermission,
  requestForegroundPermission,
  type LocationPermission,
  type LocationPermissionStatus,
} from "./permissions";
export { getCurrentPosition, getLastKnownPosition, getRecentPosition, type LocationAccuracy, type Position } from "./position";
export { reverseGeocode, type GeocodedPlace } from "./geocoding";
export {
  defineGeofenceExitTask,
  defineLocationTask,
  definePeriodicTask,
  hasStartedLocationUpdates,
  registerPeriodicTask,
  startGeofence,
  startLocationUpdates,
  stopGeofence,
  stopLocationUpdates,
  unregisterPeriodicTask,
  type BackgroundUpdateOptions,
  type GeofenceRegion,
} from "./background";
export {
  MapView,
  Marker,
  Polyline,
  type LatLng,
  type MapMarkerProps,
  type MapPolylineProps,
  type MapStyleElement,
  type MapViewHandle,
  type MapViewProps,
  type Region,
} from "./maps";
