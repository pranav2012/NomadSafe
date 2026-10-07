const { withAndroidManifest } = require("@expo/config-plugins");

const FEATURE = "android.hardware.vulkan.version";

/** Skia Graphite draws only through Vulkan on Android (no GL fallback): require Vulkan 1.1 (0x401000). */
module.exports = function withVulkanRequirement(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const features = (manifest["uses-feature"] ??= []);
    const existing = features.find((f) => f.$?.["android:name"] === FEATURE);
    const attrs = { "android:name": FEATURE, "android:version": "0x401000", "android:required": "true" };
    if (existing) existing.$ = attrs;
    else features.push({ $: attrs });
    return cfg;
  });
};
