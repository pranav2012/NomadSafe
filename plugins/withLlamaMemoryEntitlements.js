const { withEntitlementsPlist } = require("@expo/config-plugins");

/**
 * llama.rn's memory entitlements for production iOS builds. llama.rn's own option writes them into
 * `ios.entitlements` only when EAS_BUILD_PROFILE is set, which makes the runtime fingerprint differ
 * between the local `eas build` check and the EAS builder. Adding them as a mod keeps the config
 * (and so the fingerprint) the same everywhere.
 */
module.exports = function withLlamaMemoryEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const production = process.env.EAS_BUILD_PROFILE === "production" || process.env.NODE_ENV === "production";
    if (production) {
      cfg.modResults["com.apple.developer.kernel.extended-virtual-addressing"] = true;
      cfg.modResults["com.apple.developer.kernel.increased-memory-limit"] = true;
    }
    return cfg;
  });
};
