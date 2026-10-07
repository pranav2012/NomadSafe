import type { HealthApi } from "./types";

/** Platforms without a health store (web, tests). */
export const health: HealthApi = {
  source: null,
  availability: async () => "unsupported",
  requestAccess: async () => false,
  readWalking: async () => null,
  readDailySteps: async () => null,
  openInstall: () => {},
};
