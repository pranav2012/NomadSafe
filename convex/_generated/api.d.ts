/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as ai from "../ai.js";
import type * as analytics from "../analytics.js";
import type * as appCheck from "../appCheck.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as billingRules from "../billingRules.js";
import type * as crons from "../crons.js";
import type * as embassies from "../embassies.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as legalPages from "../legalPages.js";
import type * as migrations from "../migrations.js";
import type * as places from "../places.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as rates from "../rates.js";
import type * as ratesRules from "../ratesRules.js";
import type * as reviewer from "../reviewer.js";
import type * as safetyAlerts from "../safetyAlerts.js";
import type * as securityRules from "../securityRules.js";
import type * as sharing from "../sharing.js";
import type * as sync from "../sync.js";
import type * as users from "../users.js";
import type * as weather from "../weather.js";
import type * as weatherRules from "../weatherRules.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  ai: typeof ai;
  analytics: typeof analytics;
  appCheck: typeof appCheck;
  auth: typeof auth;
  billing: typeof billing;
  billingRules: typeof billingRules;
  crons: typeof crons;
  embassies: typeof embassies;
  groups: typeof groups;
  http: typeof http;
  legalPages: typeof legalPages;
  migrations: typeof migrations;
  places: typeof places;
  pushNotifications: typeof pushNotifications;
  rates: typeof rates;
  ratesRules: typeof ratesRules;
  reviewer: typeof reviewer;
  safetyAlerts: typeof safetyAlerts;
  securityRules: typeof securityRules;
  sharing: typeof sharing;
  sync: typeof sync;
  users: typeof users;
  weather: typeof weather;
  weatherRules: typeof weatherRules;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
