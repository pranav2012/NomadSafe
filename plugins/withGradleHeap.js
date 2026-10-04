const { withGradleProperties } = require("@expo/config-plugins");

const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";

/** R8 runs out of memory on the template's 2 GB Gradle heap when minifying release builds. */
module.exports = function withGradleHeap(config) {
  return withGradleProperties(config, (cfg) => {
    const existing = cfg.modResults.find((item) => item.type === "property" && item.key === "org.gradle.jvmargs");
    if (existing) existing.value = JVM_ARGS;
    else cfg.modResults.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    return cfg;
  });
};
