// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Third-party SDKs are only used inside their module, so swapping one means changing one folder.
const vendorModules = [
  { group: ['posthog-react-native'], message: 'Use @/modules/analytics (track, flags, PrivateView).' },
  { group: ['llama.rn'], message: 'Use @/modules/ai; AI routing lives in src/modules/ai/policy.ts.' },
  { group: ['react-native-purchases'], message: 'Use @/modules/billing.' },
  { group: ['react-native-google-mobile-ads'], message: 'Use @/modules/ads.' },
  { group: ['react-native-mmkv', 'expo-secure-store', 'react-native-keychain'], message: 'Use @/modules/storage.' },
  { group: ['expo-notifications'], message: 'Use @/modules/notifications.' },
  { group: ['expo-location', 'react-native-maps', 'expo-task-manager'], message: 'Use @/modules/location (or the owning module for other background tasks).' },
  { group: ['@react-native-firebase/*'], message: 'Use @/modules/appCheck.' },
  { group: ['react-native-health-connect', '@kingstinct/react-native-healthkit'], message: 'Use @/modules/health.' },
  {
    group: ['convex/*', '@convex/*', '@convex-dev/*'],
    message: 'Use @/modules/backend for the Convex client, api and hooks.',
  },
  { group: ['@/modules/*/*'], message: 'Import a module from its index (@/modules/<name>), not its internals.' },
  { group: ['@/atoms/*'], message: 'Import shared UI from @/atoms.' },
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'convex/_generated/*', 'android/*', 'ios/*', 'website/*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/modules/**', 'src/atoms/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: vendorModules }],
    },
  },
]);
