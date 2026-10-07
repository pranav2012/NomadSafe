const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

const CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

// Release only: debug builds keep Expo's debug manifest (cleartext on) so they can reach Metro.
const RELEASE_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <application android:networkSecurityConfig="@xml/network_security_config" tools:replace="android:networkSecurityConfig" />
</manifest>
`;

/**
 * Android release builds refuse plain-HTTP traffic and trust only system CAs, written out as an
 * explicit network security config instead of relying on the targetSdk default.
 */
module.exports = function withNetworkSecurity(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const appDir = path.join(cfg.modRequest.platformProjectRoot, "app", "src");
      const xmlDir = path.join(appDir, "main", "res", "xml");
      const releaseDir = path.join(appDir, "release");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.mkdirSync(releaseDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "network_security_config.xml"), CONFIG_XML);
      fs.writeFileSync(path.join(releaseDir, "AndroidManifest.xml"), RELEASE_MANIFEST);
      return cfg;
    },
  ]);
};
