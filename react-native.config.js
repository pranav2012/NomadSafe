// React Native Firebase (App Check) is Android-only until iOS has a GoogleService-Info.plist; its iOS
// pods need dynamic frameworks for SPM. See docs/PLAY_RELEASE.md ("App Check") before removing this.
module.exports = {
  dependencies: {
    "@react-native-firebase/app": { platforms: { ios: null } },
    "@react-native-firebase/app-check": { platforms: { ios: null } },
  },
};
