/**
 * Expo config (SPEC.md §13.1, §14.1; CLAUDE.md invariant 3).
 *
 * The `blockedPermissions` list is the second line of defence after the manifest check in
 * `scripts/check-privacy-invariants.ts`: Expo strips these even if a library declares them.
 * Mutual must never ship a location permission (invariant 3). If BLE stops working without
 * one, that is an escalation, never a workaround.
 */

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Permissions that may never appear in the merged manifest, whatever a library asks for.
 *
 * Expo turns this list into `tools:node="remove"` entries, which is the only mechanism that
 * survives Gradle's library-manifest merge. A config plugin that deletes the element instead
 * wins only until a dependency re-adds it -- which is exactly what happened with
 * SYSTEM_ALERT_WINDOW, found by inspecting the first real APK (DECISIONS_LOG 26).
 */
const BLOCKED_PERMISSIONS = [
  // Location: invariant 3, absolutely.
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  // Draw-over-other-apps, pulled in by expo-dev-client's dev menu. Nothing a participant
  // installs has any business holding it.
  'android.permission.SYSTEM_ALERT_WINDOW',
  // expo-image-picker declares CAMERA even though Mutual only ever reads from the photo
  // library (`launchImageLibraryAsync`) and never takes a photo in-app.
  'android.permission.CAMERA',
];

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];

/** Our plugin list wins on configuration; anything app.json adds and we do not name is kept. */
function mergePlugins(fromJson: ExpoConfig['plugins'], ours: PluginEntry[]): PluginEntry[] {
  const nameOf = (entry: PluginEntry): string =>
    Array.isArray(entry) ? String(entry[0]) : String(entry);
  const named = new Set(ours.map(nameOf));
  return [...ours, ...(fromJson ?? []).filter((entry) => !named.has(nameOf(entry)))];
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Mutual',
  slug: 'mutual',
  scheme: 'mutual',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // "automatic" so the OS light/dark setting drives the theme (SPEC §13.4, §13.7).
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: ['**/*'],
  android: {
    // Not in.mutual.*: `in` is a Kotlin keyword, and Expo's autolinking generator
    // writes package names unquoted into generated Kotlin (DECISIONS_LOG 25).
    package: 'app.mutual',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#F7F3EE',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    blockedPermissions: BLOCKED_PERMISSIONS,
    permissions: [
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ],
  },
  // iOS is out of scope (decision D1). No iOS block is declared on purpose.
  // `expo install` maintains the autolinked plugin list in app.json; those are merged in
  // rather than replaced, so a future `expo install` is not silently discarded here.
  plugins: mergePlugins(config.plugins, [
    // Local plugin: BLUETOOTH_SCAN needs usesPermissionFlags="neverForLocation", which the
    // `permissions` list above cannot express (SPEC §14.1, invariant 3).
    './plugins/withBleNeverForLocation',
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    'expo-font',
    'expo-audio',
    'expo-background-task',
    'expo-system-ui',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 31, // Android 12+: BLE scanning without a location permission (D1)
          compileSdkVersion: 36,
          targetSdkVersion: 36,
        },
      },
    ],
  ]),
  experiments: { typedRoutes: true },
  extra: {
    // Overridable per machine without editing code; see src/api/client.ts.
    serverBaseUrl: process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://10.0.2.2:8000',
    env: process.env.EXPO_PUBLIC_MUTUAL_ENV ?? 'dev',
  },
});
