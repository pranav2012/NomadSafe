// Background tasks must be defined before the router loads so Android can run
// them on a headless (no UI) launch.
import "@/features/location-sharing/services/locationBroadcastTask";
import "@/features/ai/services/modelDownloadTask";
import "expo-router/entry";
