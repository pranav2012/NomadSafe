import { getRequestStatusForAuthorization, isHealthDataAvailable, queryStatisticsForQuantity, requestAuthorization } from "@kingstinct/react-native-healthkit";
import { logger } from "@/modules/logger";
import { STRIDE_KM, type HealthApi } from "./types";

const READ = { toRead: ["HKQuantityTypeIdentifierStepCount", "HKQuantityTypeIdentifierDistanceWalkingRunning"] } as const;

export const health: HealthApi = {
  source: "apple_health",
  async availability() {
    if (!isHealthDataAvailable()) return "unsupported";
    try {
      // Throws on builds without the HealthKit entitlement (see plugins/withHealthKitGate.js).
      await getRequestStatusForAuthorization(READ);
      return "available";
    } catch {
      return "unsupported";
    }
  },
  async requestAccess() {
    try {
      // HealthKit never says whether reading was allowed; an empty result later means it wasn't.
      return await requestAuthorization(READ);
    } catch (err) {
      logger.warn("health", "authorization failed", err);
      return false;
    }
  },
  async readWalking(start, end) {
    const filter = { date: { startDate: start, endDate: end } };
    try {
      const [steps, distance] = await Promise.all([
        queryStatisticsForQuantity("HKQuantityTypeIdentifierStepCount", ["cumulativeSum"], { filter, unit: "count" }),
        queryStatisticsForQuantity("HKQuantityTypeIdentifierDistanceWalkingRunning", ["cumulativeSum"], { filter, unit: "km" }),
      ]);
      const count = steps.sumQuantity?.quantity ?? 0;
      const km = distance.sumQuantity?.quantity ?? 0;
      if (count <= 0 && km <= 0) return null;
      return km > 0 ? { steps: count, km, estimated: false } : { steps: count, km: count * STRIDE_KM, estimated: true };
    } catch (err) {
      logger.warn("health", "read failed", err);
      return null;
    }
  },
  openInstall() {},
};
