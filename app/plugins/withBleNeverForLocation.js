/**
 * A local Expo config plugin that adds `android:usesPermissionFlags="neverForLocation"` to
 * `BLUETOOTH_SCAN` (SPEC.md §14.1, CLAUDE.md invariant 3, claim C4).
 *
 * Why a plugin is needed: `android.permissions` in app.config.ts can only list permission
 * *names*. The flag is a separate attribute, and without it Android treats a BLE scan as a
 * potential location inference and requires a location permission -- which Mutual must
 * never request. Expo's generated manifest therefore has to be edited directly.
 *
 * The flag is a promise to the OS that the app does not derive location from BLE results.
 * Mutual keeps that promise: it never computes a position, and the only thing it does with
 * a scan result is hash it with a secret (SPEC §6.13).
 *
 * It does **only** that. An earlier version also deleted `SYSTEM_ALERT_WINDOW` from the
 * manifest, which looked right at prebuild and was useless in the built APK: Gradle merges
 * library manifests afterwards, and `expo-dev-client` re-added it. Permissions that must be
 * absent belong in `android.blockedPermissions` (which emits `tools:node="remove"`), not in
 * a plugin that edits the element. See DECISIONS_LOG 26.
 */

const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SCAN = 'android.permission.BLUETOOTH_SCAN';

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withBleNeverForLocation = (config) =>
  withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const permissions = manifest['uses-permission'] ?? [];

    let scan = permissions.find((p) => p.$?.['android:name'] === SCAN);
    if (!scan) {
      scan = { $: { 'android:name': SCAN } };
      permissions.push(scan);
    }
    scan.$['android:usesPermissionFlags'] = 'neverForLocation';
    manifest['uses-permission'] = permissions;

    // Keep `tools:` usable: blockedPermissions already relies on it, but a fresh manifest
    // template may not declare the namespace.
    AndroidConfig.Manifest.ensureToolsAvailable(modConfig.modResults);
    return modConfig;
  });

module.exports = withBleNeverForLocation;
