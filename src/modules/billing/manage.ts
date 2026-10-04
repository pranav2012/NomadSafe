import type { CustomerInfo } from "react-native-purchases";

export type ManageTarget = { kind: "test" } | { kind: "lifetime" } | { kind: "url"; url: string };

type ManageInfo = Pick<CustomerInfo, "activeSubscriptions" | "managementURL"> & {
  entitlements: { active: Record<string, Pick<CustomerInfo["entitlements"]["active"][string], "store" | "expirationDate">> };
};

const PLAY_SUBSCRIPTIONS = "https://play.google.com/store/account/subscriptions";
const APPLE_SUBSCRIPTIONS = "https://apps.apple.com/account/subscriptions";

/** Active access that never expires and isn't a subscription (the lifetime plan). */
export function isLifetimePlan(info: ManageInfo): boolean {
  const active = Object.values(info.entitlements.active);
  return info.activeSubscriptions.length === 0 && active.length > 0 && active.every((entitlement) => entitlement.expirationDate === null);
}

/**
 * Where "Manage subscription" should go. Test Store and lifetime purchases have nothing to manage in
 * a store; otherwise RevenueCat's management URL, else the store's own subscriptions page.
 */
export function manageTarget(info: ManageInfo, os: string, packageName: string): ManageTarget {
  const active = Object.values(info.entitlements.active);
  if (active.some((entitlement) => entitlement.store === "TEST_STORE")) return { kind: "test" };
  if (isLifetimePlan(info)) return { kind: "lifetime" };
  if (info.managementURL) return { kind: "url", url: info.managementURL };
  if (os === "ios") return { kind: "url", url: APPLE_SUBSCRIPTIONS };
  // Play product ids from RevenueCat carry the base plan as "product:base-plan".
  const sku = info.activeSubscriptions[0]?.split(":")[0];
  const query = sku ? `?sku=${encodeURIComponent(sku)}&package=${packageName}` : `?package=${packageName}`;
  return { kind: "url", url: `${PLAY_SUBSCRIPTIONS}${query}` };
}
