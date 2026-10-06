/**
 * AC-T2-3 / claim C4: the privacy invariants that can be checked statically.
 *
 * Run with `npm run check:privacy -w app`. It is also a pre-commit hook, so a change that
 * breaks one of these cannot be committed without noticing.
 *
 * Four checks:
 *   1. **No location permission** in the merged Android manifest, and `BLUETOOTH_SCAN`
 *      carries `usesPermissionFlags="neverForLocation"` (CLAUDE.md invariant 3).
 *      Skipped with a clear message, not a silent pass, when `expo prebuild` has not been
 *      run -- the manifest does not exist until then.
 *   2. **No denylisted SDK** in any package.json in the repo (invariant 6).
 *   3. **No network call outside `src/api/client.ts`** (invariant 1).
 *   4. **Location permissions are blocked in app.config.ts**, so they stay out even if a
 *      future library declares one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const APP_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(APP_ROOT, '..');

/** Permissions that must never appear in the merged manifest (invariant 3). */
const FORBIDDEN_PERMISSIONS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
];

/**
 * Permissions that must be absent for product reasons rather than invariant 3, and which
 * a dependency declares on our behalf. Checked here because the first real APK carried
 * both of these despite a config plugin deleting them at prebuild (DECISIONS_LOG 26).
 */
const UNWANTED_PERMISSIONS = [
  // expo-image-picker declares it even though Mutual only reads from the photo library.
  'android.permission.CAMERA',
];

/**
 * Permissions that React Native's **debug** AAR declares and that
 * `android.blockedPermissions` cannot remove, because a library's own declaration wins
 * over `tools:node="remove"` in the merge.
 *
 * `SYSTEM_ALERT_WINDOW` is declared by `react-android-<version>-debug`'s manifest for the
 * dev overlay (LogBox). It is expected in a debug build and reported as a note there. It
 * must **not** appear in a release manifest, and the check fails if it does -- which is the
 * build a participant would ever install. Investigated and recorded in DECISIONS_LOG 26
 * rather than quietly tolerated.
 */
const DEBUG_ONLY_PERMISSIONS = ['android.permission.SYSTEM_ALERT_WINDOW'];

/** Analytics, crash-reporting and ad SDKs (invariant 6). */
const DENYLISTED_SDKS = [
  '@amplitude/',
  '@datadog/',
  '@segment/',
  '@sentry/',
  'amplitude-js',
  'analytics-react-native',
  'appsflyer',
  'branch-sdk',
  'bugsnag',
  'firebase',
  '@react-native-firebase/',
  'mixpanel',
  'posthog',
  'react-native-google-mobile-ads',
  'rudder-sdk',
  'sentry-expo',
];

/** Files allowed to call the network. */
const NETWORK_ALLOWLIST = [join('src', 'api', 'client.ts')];

const failures: string[] = [];
const notes: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function walk(dir: string, onFile: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.expo', 'android', 'ios', 'dist', '.venv'].includes(entry.name))
        continue;
      walk(path, onFile);
    } else if (entry.isFile()) {
      onFile(path);
    }
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 1. manifest

/**
 * Candidate manifests, strictest first.
 *
 * Gradle's merged manifest is the real answer, but it only exists after a build. The
 * prebuild source manifest is checked otherwise, and it needs one extra rule: Expo
 * implements `android.blockedPermissions` by *declaring* the permission with
 * `tools:node="remove"`, so the name appearing there means the opposite of a leak. A
 * declaration without that attribute is a real one.
 */
function manifestCandidates(): { path: string; merged: boolean }[] {
  const base = join(APP_ROOT, 'android', 'app');
  const mergedRoot = join(base, 'build', 'intermediates', 'merged_manifests');

  // Searched rather than guessed: Gradle's task directory under merged_manifests/<variant>
  // is named after the task (processDebugManifest, processDebugMainManifest, ...) and has
  // changed between AGP versions. A hard-coded path silently falls through to the weaker
  // prebuild manifest, which is what happened the first time.
  const merged: string[] = [];
  const walkForManifests = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walkForManifests(path);
      else if (entry.name === 'AndroidManifest.xml') merged.push(path);
    }
  };
  walkForManifests(mergedRoot);
  // Prefer a debug variant, which is what a dev build produces.
  merged.sort((a, b) => Number(b.includes('debug')) - Number(a.includes('debug')));

  return [
    ...merged.map((path) => ({ path, merged: true })),
    { path: join(base, 'src', 'main', 'AndroidManifest.xml'), merged: false },
  ];
}

function checkManifest(): void {
  const found = manifestCandidates().find(({ path }) => exists(path));
  if (!found) {
    notes.push(
      'No Android manifest found. Run `npx expo prebuild --platform android` in app/ to ' +
        'generate it, then re-run this check (AC-T2-3 is verified against the prebuild output).',
    );
    return;
  }
  const xml = readFileSync(found.path, 'utf8');
  const where = found.merged ? 'Merged manifest' : 'Prebuild manifest';

  // Each <uses-permission .../> element, so the removal attribute can be read per element.
  const elements = xml.match(/<uses-permission\b[^>]*>/g) ?? [];
  const declares = (name: string): string | undefined =>
    elements.find((el) => el.includes(name) && !/tools:node\s*=\s*"remove"/.test(el));

  for (const permission of FORBIDDEN_PERMISSIONS) {
    if (declares(permission)) {
      fail(`${where} declares ${permission}. CLAUDE.md invariant 3 forbids location.`);
    }
    if (found.merged && xml.includes(permission)) {
      // After merging, a removed permission should be gone entirely.
      fail(`${where} still contains ${permission} after merging.`);
    }
  }

  for (const permission of UNWANTED_PERMISSIONS) {
    if (declares(permission)) {
      fail(
        `${where} declares ${permission}, which no build should carry. Add it to ` +
          'android.blockedPermissions in app.config.ts -- a config plugin that deletes the ' +
          'element is undone by the library-manifest merge (DECISIONS_LOG 26).',
      );
    }
  }

  // React Native's debug AAR declares the dev-overlay permission and wins over
  // tools:node="remove". Expected in debug, forbidden in release.
  const isDebugManifest = found.path.toLowerCase().includes('debug');
  for (const permission of DEBUG_ONLY_PERMISSIONS) {
    if (!declares(permission)) continue;
    if (isDebugManifest) {
      notes.push(
        `${permission} is present, declared by react-android's debug AAR for the dev ` +
          'overlay. Expected in a debug build; this check fails on it in a release build.',
      );
    } else {
      fail(
        `${where} declares ${permission}. A release build must not carry the dev-overlay ` +
          'permission (DECISIONS_LOG 26).',
      );
    }
  }

  const scan = declares('android.permission.BLUETOOTH_SCAN');
  if (!scan) {
    fail(`${where} does not declare BLUETOOTH_SCAN (SPEC §14.1).`);
  } else if (!scan.includes('neverForLocation')) {
    fail(
      'BLUETOOTH_SCAN is missing usesPermissionFlags="neverForLocation" ' +
        '(SPEC §14.1, claim C4). See app/plugins/withBleNeverForLocation.js.',
    );
  }

  notes.push(`manifest checked: ${relative(APP_ROOT, found.path)}`);
}

// ------------------------------------------------------------------- 2. SDKs

function checkDenylistedSdks(): void {
  walk(REPO_ROOT, (path) => {
    if (!path.endsWith('package.json')) return;
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return;
    }
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };
    for (const name of Object.keys(deps)) {
      const hit = DENYLISTED_SDKS.find((bad) => name === bad || name.startsWith(bad));
      if (hit) {
        fail(
          `${relative(REPO_ROOT, path)} depends on "${name}" (matches denylisted "${hit}"). ` +
            'CLAUDE.md invariant 6 forbids third-party analytics, crash reporting and ad SDKs.',
        );
      }
    }
  });
}

// --------------------------------------------------------- 3. network boundary

function checkNetworkBoundary(): void {
  const sources = [join(APP_ROOT, 'src'), join(APP_ROOT, 'app'), join(APP_ROOT, 'modules')];
  for (const root of sources) {
    if (!exists(root)) continue;
    walk(root, (path) => {
      if (!/\.(ts|tsx)$/.test(path)) return;
      const rel = relative(APP_ROOT, path);
      if (NETWORK_ALLOWLIST.includes(rel) || NETWORK_ALLOWLIST.includes(rel.split(sep).join(sep)))
        return;
      const text = readFileSync(path, 'utf8');
      // Strip comments so a doc comment explaining the rule does not trip it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/\bfetch\s*\(/.test(code)) {
        fail(`${rel} calls fetch(). Network access goes through src/api/client.ts only.`);
      }
      if (/\bXMLHttpRequest\b/.test(code)) {
        fail(`${rel} uses XMLHttpRequest. Network access goes through src/api/client.ts only.`);
      }
    });
  }
}

// ----------------------------------------------------------- 4. blocked config

function checkBlockedPermissions(): void {
  const config = join(APP_ROOT, 'app.config.ts');
  if (!exists(config)) {
    fail('app.config.ts is missing.');
    return;
  }
  const text = readFileSync(config, 'utf8');
  if (!text.includes('blockedPermissions')) {
    fail('app.config.ts does not set android.blockedPermissions (SPEC §14.1).');
    return;
  }
  for (const permission of FORBIDDEN_PERMISSIONS) {
    if (!text.includes(permission)) {
      fail(`app.config.ts does not block ${permission} (CLAUDE.md invariant 3).`);
    }
  }
}

checkManifest();
checkDenylistedSdks();
checkNetworkBoundary();
checkBlockedPermissions();

for (const note of notes) console.warn(`note: ${note}`);

if (failures.length > 0) {
  console.error('\nPrivacy invariant check FAILED:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`Privacy invariants OK (${notes.length} note(s) above).`);
