import { Linking } from "react-native";
import { aggregateGroupByPeriod, aggregateRecord, getSdkStatus, initialize, requestPermission, SdkAvailabilityStatus } from "react-native-health-connect";
import { logger } from "@/modules/logger";
import { STRIDE_KM, type HealthApi } from "./types";

const INSTALL_URL = "market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding";
let initialized: Promise<boolean> | null = null;

const ready = () => (initialized ??= initialize().catch(() => false));

export const health: HealthApi = {
  source: "health_connect",
  async availability() {
    try {
      const status = await getSdkStatus();
      if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return "available";
      if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "needs_update";
      return "unsupported";
    } catch {
      return "unsupported";
    }
  },
  async requestAccess() {
    if (!(await ready())) return false;
    try {
      // History lets trips that ended more than 30 days before access was granted show their steps too.
      const granted = await requestPermission([
        { accessType: "read", recordType: "Steps" },
        { accessType: "read", recordType: "Distance" },
        { accessType: "read", recordType: "ReadHealthDataHistory" },
      ]);
      return granted.some((permission) => permission.recordType === "Steps");
    } catch (err) {
      logger.warn("health", "permission request failed", err);
      return false;
    }
  },
  async readWalking(start, end) {
    if (!(await ready())) return null;
    const timeRangeFilter = { operator: "between" as const, startTime: start.toISOString(), endTime: end.toISOString() };
    try {
      const steps = (await aggregateRecord({ recordType: "Steps", timeRangeFilter })).COUNT_TOTAL ?? 0;
      let meters = 0;
      try {
        meters = (await aggregateRecord({ recordType: "Distance", timeRangeFilter })).DISTANCE?.inMeters ?? 0;
      } catch {
        // Distance permission may be denied; steps alone still give an estimate.
      }
      if (steps <= 0 && meters <= 0) return null;
      return meters > 0 ? { steps, km: meters / 1000, estimated: false } : { steps, km: steps * STRIDE_KM, estimated: true };
    } catch (err) {
      logger.warn("health", "read failed", err);
      return null;
    }
  },
  async readDailySteps(start, end) {
    if (!(await ready())) return null;
    try {
      const days = await aggregateGroupByPeriod({
        recordType: "Steps",
        timeRangeFilter: { operator: "between", startTime: start.toISOString(), endTime: end.toISOString() },
        timeRangeSlicer: { period: "DAYS", length: 1 },
      });
      // Period buckets are local days; startTime is a local date-time ("2026-10-18T00:00").
      return days.map((day) => ({ date: day.startTime.slice(0, 10), steps: day.result.COUNT_TOTAL ?? 0 })).filter((day) => day.steps > 0);
    } catch (err) {
      logger.warn("health", "daily read failed", err);
      return null;
    }
  },
  openInstall() {
    void Linking.openURL(INSTALL_URL);
  },
};
