const { withGradleProperties } = require("@expo/config-plugins");

/**
 * react-native-google-mobile-ads 17.2 reads `rootProject.ext.googleMobileAdsJson`, which its
 * app-json.gradle never sets for Expo projects (it sets a misspelled `googleAdsJson`), so Gradle
 * fails. Setting the backend explicitly skips that lookup; "classic" is the library's default.
 */
module.exports = function withGoogleMobileAdsBackend(config) {
  return withGradleProperties(config, (cfg) => {
    if (!cfg.modResults.some((item) => item.type === "property" && item.key === "RNGMA_ANDROID_BACKEND")) {
      cfg.modResults.push({ type: "property", key: "RNGMA_ANDROID_BACKEND", value: "classic" });
    }
    return cfg;
  });
};
