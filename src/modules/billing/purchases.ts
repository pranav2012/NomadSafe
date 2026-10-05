import { Linking, Platform } from "react-native";
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  STORE_REPLACEMENT_MODE,
  type CustomerInfo,
  type PurchasesPackage,
} from "react-native-purchases";
import { api, convex } from "@/modules/backend";
import { withAppCheck } from "@/modules/appCheck";
import { logger } from "@/modules/logger";
import { isLifetimePlan, manageTarget } from "./manage";
import { usePlanStore } from "./planStore";
import { planFromEntitlements, tierOf, type PlanTier } from "./plan";
import { withSystemPrompt } from "@/utils/systemPrompt";

export const PACKAGE_IDS = {
  plusMonthly: "plus_monthly",
  plusAnnual: "plus_annual",
  plusLifetime: "plus_lifetime",
  proMonthly: "pro_monthly",
  proAnnual: "pro_annual",
} as const;

export type PackageId = (typeof PACKAGE_IDS)[keyof typeof PACKAGE_IDS];

// RevenueCat's Test Store key simulates purchases. The SDK closes any release build that uses it,
// so only development builds may.
const testStoreKey = __DEV__ ? process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY : undefined;

const apiKey =
  testStoreKey ||
  Platform.select({
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  });

let configured = false;
let identifiedUserId: string | null = null;

const ANDROID_PACKAGE = "com.pranav.nomadsafe";

function applyCustomerInfo(info: CustomerInfo) {
  const store = usePlanStore.getState();
  store.setPlan(planFromEntitlements(Object.keys(info.entitlements.active)));
  store.setLifetime(isLifetimePlan(info));
}

/** Tells the server to re-read the plan from RevenueCat so cloud AI unlocks without waiting for the webhook. */
function refreshServerPlan() {
  withAppCheck({})
    .then((args) => convex.action(api.billing.refreshMyPlan, args))
    .catch((error: unknown) => {
      logger.warn("purchases", "server plan refresh failed", error);
    });
}

/** Configures RevenueCat once. Builds without a key run as Free with the paywall disabled. */
export function configurePurchases() {
  if (configured) return;
  if (!apiKey) {
    usePlanStore.getState().setBillingAvailable(false);
    return;
  }
  if (__DEV__) void Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey });
  Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
  configured = true;
  usePlanStore.getState().setBillingAvailable(true);
}

/** Links purchases to the signed-in account, or drops back to an anonymous customer on sign-out. */
export async function identifyPurchaser(userId: string | null) {
  if (!configured || userId === identifiedUserId) return;
  const previous = identifiedUserId;
  identifiedUserId = userId;
  try {
    if (userId) {
      const { customerInfo } = await Purchases.logIn(userId);
      applyCustomerInfo(customerInfo);
    } else {
      usePlanStore.getState().reset();
      if (previous && !(await Purchases.isAnonymous())) await Purchases.logOut();
    }
  } catch (error) {
    identifiedUserId = previous;
    logger.warn("purchases", "identify failed", error);
  }
}

export async function loadPackages(): Promise<Partial<Record<PackageId, PurchasesPackage>>> {
  if (!configured) return {};
  const offerings = await Purchases.getOfferings();
  const packages: Partial<Record<PackageId, PurchasesPackage>> = {};
  for (const pkg of offerings.current?.availablePackages ?? []) {
    if (Object.values(PACKAGE_IDS).includes(pkg.identifier as PackageId)) packages[pkg.identifier as PackageId] = pkg;
  }
  return packages;
}

export function packageTier(id: PackageId): PlanTier {
  return id.startsWith("pro") ? "pro" : "plus";
}

const DAYS_PER_UNIT: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

function toDays(unit: string, count: number): number | null {
  return (DAYS_PER_UNIT[unit] ?? 0) * count || null;
}

/**
 * Free-trial length in days, or null. Play only puts a trial in the default offer for eligible
 * users; the App Store always reports the intro offer, so iOS callers pass `introEligible`.
 */
export function freeTrialDays(pkg: PurchasesPackage | undefined, introEligible = false): number | null {
  if (!pkg) return null;
  const playTrial = pkg.product.defaultOption?.freePhase?.billingPeriod;
  if (playTrial) return toDays(playTrial.unit, playTrial.value);
  const intro = pkg.product.introPrice;
  if (!introEligible || !intro || intro.price > 0) return null;
  return toDays(intro.periodUnit, intro.periodNumberOfUnits * intro.cycles);
}

/** iOS: product ids whose free trial this Apple ID can still use. Unknown counts as not eligible. */
export async function introEligibleProducts(packages: PurchasesPackage[]): Promise<Set<string>> {
  const ids = packages.filter((pkg) => pkg.product.introPrice).map((pkg) => pkg.product.identifier);
  if (Platform.OS !== "ios" || ids.length === 0) return new Set();
  const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(ids);
  return new Set(ids.filter((id) => result[id]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE));
}

/**
 * Android subscription switches (Plus → Pro, monthly → annual) replace the current Play
 * subscription instead of adding a second one. Lifetime is a one-time product and never replaces.
 */
async function productChangeFor(pkg: PurchasesPackage) {
  if (Platform.OS !== "android" || pkg.identifier === PACKAGE_IDS.plusLifetime) return null;
  const { activeSubscriptions } = await Purchases.getCustomerInfo();
  const current = activeSubscriptions.find((id) => id !== pkg.product.identifier);
  if (!current) return null;
  const upgrading = packageTier(pkg.identifier as PackageId) === "pro" && !current.startsWith("pro");
  return {
    oldProductIdentifier: current.split(":")[0],
    replacementMode: upgrading ? STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE : STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION,
  };
}

export type PurchaseOutcome = "purchased" | "cancelled";

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await withSystemPrompt(async () => Purchases.purchasePackage(pkg, null, await productChangeFor(pkg)));
    applyCustomerInfo(customerInfo);
    refreshServerPlan();
    return "purchased";
  } catch (error) {
    const code = (error as { code?: string; userCancelled?: boolean | null }) ?? {};
    if (code.userCancelled || code.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return "cancelled";
    throw error;
  }
}

/** Restores store purchases onto this account; returns the resulting tier. */
export async function restorePurchases(): Promise<PlanTier> {
  const info = await withSystemPrompt(() => Purchases.restorePurchases());
  applyCustomerInfo(info);
  refreshServerPlan();
  return tierOf(planFromEntitlements(Object.keys(info.entitlements.active)));
}

export async function hasActiveSubscription(): Promise<boolean> {
  if (!configured) return false;
  const info = await Purchases.getCustomerInfo();
  return info.activeSubscriptions.length > 0;
}

/** "opened" = the store's subscription page; "lifetime" / "test" = nothing to manage in a store (the caller explains). */
export type ManageOutcome = "opened" | "lifetime" | "test";

/** Opens the store page for the active subscription. Throws when the plan can't be read or the page can't open. */
export async function manageSubscriptions(): Promise<ManageOutcome> {
  try {
    const info = await Purchases.getCustomerInfo();
    applyCustomerInfo(info);
    const target = manageTarget(info, Platform.OS, ANDROID_PACKAGE);
    if (target.kind !== "url") return target.kind;
    await Linking.openURL(target.url);
    return "opened";
  } catch (error) {
    logger.warn("purchases", "manage subscription failed", error);
    throw error;
  }
}
