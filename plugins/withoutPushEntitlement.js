const { withEntitlementsPlist } = require("@expo/config-plugins");

/**
 * expo-notifications always adds the `aps-environment` (remote push) entitlement, which forces
 * signing against a paid, Push-enabled Apple team. Until IOS_PUSH_ENABLED=1 is set (paid account +
 * APNs key in EAS), strip it so iOS builds sign on a free team; shared-trip push then works on
 * Android only, and iOS still gets live updates while the app is open.
 */
module.exports = function withoutPushEntitlement(config) {
  if (process.env.IOS_PUSH_ENABLED === "1") return config;
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    return cfg;
  });
};
