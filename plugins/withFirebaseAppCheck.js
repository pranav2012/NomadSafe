const { withPlugins } = require("@expo/config-plugins");

/**
 * React Native Firebase (App Check). Android needs nothing extra: Expo already applies the
 * google-services plugin for `android.googleServicesFile`. The RNFB plugins throw without
 * `ios.googleServicesFile`, so iOS is configured only once a GoogleService-Info.plist exists; the
 * iOS pods are also excluded in react-native.config.js until then (see docs/PLAY_RELEASE.md).
 */
module.exports = function withFirebaseAppCheck(config) {
  if (!config.ios?.googleServicesFile) return config;
  return withPlugins(config, ["@react-native-firebase/app", "@react-native-firebase/app-check"]);
};
