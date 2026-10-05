const { withMainActivity } = require("@expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

/**
 * Android 13+: the recents screen shows a blank card instead of a screenshot of the app, so trip,
 * expense and location details don't leak from the app switcher. Screenshots in normal use still work.
 */
module.exports = function withRecentsPrivacy(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== "kt") throw new Error("withRecentsPrivacy expects a Kotlin MainActivity");
    cfg.modResults.contents = mergeContents({
      src: cfg.modResults.contents,
      newSrc: "    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false)",
      tag: "nomadsafe-recents-privacy",
      anchor: /super\.onCreate\(/,
      offset: 1,
      comment: "//",
    }).contents;
    if (!cfg.modResults.contents.includes("import android.os.Build")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(/^(package .*\n)/, "$1\nimport android.os.Build\n");
    }
    return cfg;
  });
};
