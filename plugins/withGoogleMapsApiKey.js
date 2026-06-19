const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * Injects the Google Maps Android API key into AndroidManifest.xml.
 * Reads from GOOGLE_MAPS_ANDROID_API_KEY environment variable.
 */
module.exports = function withGoogleMapsApiKey(config) {
  return withAndroidManifest(config, (cfg) => {
    const apiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

    if (!apiKey) {
      throw new Error(
        "GOOGLE_MAPS_ANDROID_API_KEY is not defined. Add it to your environment before running expo prebuild."
      );
    }

    const root = cfg.modResults.manifest || cfg.modResults;
    const application = root.application?.[0] || root.application;

    if (!application) {
      throw new Error("AndroidManifest.xml is missing the <application> element.");
    }

    if (!application["meta-data"]) {
      application["meta-data"] = [];
    }

    const existing = application["meta-data"].find(
      (meta) => meta.$?.["android:name"] === "com.google.android.geo.API_KEY"
    );

    if (existing) {
      existing.$["android:value"] = apiKey;
    } else {
      application["meta-data"].push({
        $: {
          "android:name": "com.google.android.geo.API_KEY",
          "android:value": apiKey,
        },
      });
    }

    return cfg;
  });
};
