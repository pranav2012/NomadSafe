/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "share",
  name: "SaveToNomadSafe",
  bundleIdentifier: ".share",
  deploymentTarget: "17.0",
  frameworks: ["UIKit", "UniformTypeIdentifiers"],
});
