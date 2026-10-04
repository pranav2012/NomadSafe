/** Public API of the location module: permissions, positions, geocoding, background updates and maps. */
export {
  getBackgroundPermission,
  getForegroundPermission,
  requestBackgroundPermission,
  requestForegroundPermission,
  type LocationPermission,
  type LocationPermissionStatus,
} from "./permissions";
export { getCurrentPosition, getLastKnownPosition, type LocationAccuracy, type Position } from "./position";
export { reverseGeocode, type GeocodedPlace } from "./geocoding";
export {
  defineLocationTask,
  hasStartedLocationUpdates,
  startLocationUpdates,
  stopLocationUpdates,
  type BackgroundUpdateOptions,
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
