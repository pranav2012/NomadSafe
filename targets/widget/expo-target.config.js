/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "VoiceExpenseWidget",
  bundleIdentifier: ".widget",
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit", "AppIntents"],
  colors: {
    $accent: "#2B6C5F",
    $widgetBackground: { light: "#FBF6EC", dark: "#1F2529" },
    widgetPaper: { light: "#FBF6EC", dark: "#1F2529" },
    widgetTeal: { light: "#2B6C5F", dark: "#4FA693" },
  },
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
