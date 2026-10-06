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
 * The second half of the plugin removes `SYSTEM_ALERT_WINDOW`, which `expo-dev-client`
 * pulls in for its dev menu overlay. It is harmless in a dev build and has no business in
 * anything a participant installs, so it is stripped here rather than being noticed later.
 */

const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SCAN = 'android.permission.BLUETOOTH_SCAN';
const OVERLAY = 'android.permission.SYSTEM_ALERT_WINDOW';

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

    manifest['uses-permission'] = permissions.filter(
      (p) => p.$?.['android:name'] !== OVERLAY,
    );

    // Keep `tools:` usable: blockedPermissions already relies on it, but a fresh manifest
    // template may not declare the namespace.
    AndroidConfig.Manifest.ensureToolsAvailable(modConfig.modResults);
    return modConfig;
  });

module.exports = withBleNeverForLocation;
