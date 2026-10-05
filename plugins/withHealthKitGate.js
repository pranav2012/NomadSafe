const { withEntitlementsPlist } = require("@expo/config-plugins");

/**
 * The HealthKit plugin adds the `com.apple.developer.healthkit` entitlement, which (like push)
 * needs a paid Apple team. Until IOS_HEALTHKIT_ENABLED=1 is set, strip it so iOS builds keep
 * signing on a free team; steps then come from Health Connect on Android only.
 */
module.exports = function withHealthKitGate(config) {
  if (process.env.IOS_HEALTHKIT_ENABLED === "1") return config;
  return withEntitlementsPlist(config, (cfg) => {
    for (const key of Object.keys(cfg.modResults)) if (key.startsWith("com.apple.developer.healthkit")) delete cfg.modResults[key];
    return cfg;
  });
};
