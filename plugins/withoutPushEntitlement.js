const { withEntitlementsPlist } = require("@expo/config-plugins");

/**
 * expo-notifications unconditionally adds the `aps-environment` (remote push)
 * entitlement during prebuild. We only use local notifications, which don't
 * need it, and the entitlement forces signing against a Push-enabled
 * provisioning profile. Strip it so the app signs on any team.
 */
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    return cfg;
  });
};
