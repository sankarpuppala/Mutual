/**
 * A local Expo config plugin that passes `-DCMAKE_OBJECT_PATH_MAX` to the Android C++
 * build, so object-file paths stay inside Windows' 260-character limit.
 *
 * Why it is needed. CMake names each object file after the *absolute path* of its source,
 * mangled into the build directory — so a C++ file deep inside `node_modules` becomes a
 * path like:
 *
 *   <build>/rngesturehandler_codegen_autolinked_build/CMakeFiles/
 *   react_codegen_rngesturehandler_codegen.dir/C_/Users/<you>/.../node_modules/
 *   react-native-gesture-handler/shared/shadowNodes/react/renderer/components/
 *   rngesturehandler_codegen/RNGestureHandlerDetectorShadowNode.cpp.o
 *
 * That is close to 300 characters before the project's own path is added, and ninja fails
 * with "Filename longer than 260 characters". Windows' `LongPathsEnabled` is already on
 * and neither ninja nor CMake honours it.
 *
 * Shortening the project path does not fix this: even from a drive root the relative part
 * alone is over 250 characters. Nor does building through a junction or a `subst` drive —
 * Gradle and the React Native Gradle plugin both canonicalise, so the generated
 * `Android-autolinking.cmake` names the real path whatever directory the build was
 * launched from.
 *
 * `CMAKE_OBJECT_PATH_MAX` is CMake's own answer: above the given length it stops deriving
 * the object name from the source path and uses a short generated name instead. It changes
 * nothing about what is compiled.
 *
 * Only Windows needs it, but it is applied unconditionally: a build that behaves the same
 * on every machine is worth more than one that is subtly different on the maintainer's.
 *
 * Added to SPEC §20's file list in the same change that introduced it.
 */

const { withAppBuildGradle } = require('expo/config-plugins');

/** CMake's own limit; it warns below 128 and the default is effectively unlimited. */
const MAX = 240;

const MARKER = 'CMAKE_OBJECT_PATH_MAX';

const BLOCK = `
    externalNativeBuild {
        cmake {
            // Keep object-file paths under the Windows 260-character limit; see
            // app/plugins/withShortCmakeObjectPaths.js for why this is not solvable by
            // moving the project somewhere shorter.
            arguments "-D${MARKER}=${MAX}"
        }
    }
`;

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withShortCmakeObjectPaths = (config) =>
  withAppBuildGradle(config, (modConfig) => {
    const gradle = modConfig.modResults;
    if (gradle.language !== 'groovy') {
      throw new Error(
        `withShortCmakeObjectPaths expected a Groovy build.gradle, got ${gradle.language}.`,
      );
    }
    if (gradle.contents.includes(MARKER)) return modConfig;

    // Anchor on `defaultConfig {`, which the Expo template always emits exactly once.
    const anchor = /(\n\s*defaultConfig\s*\{)/;
    if (!anchor.test(gradle.contents)) {
      throw new Error(
        'withShortCmakeObjectPaths could not find `defaultConfig {` in android/app/build.gradle. ' +
          'The template changed; update the plugin rather than dropping it, or the Windows ' +
          'build breaks with "Filename longer than 260 characters".',
      );
    }
    gradle.contents = gradle.contents.replace(anchor, `$1\n${BLOCK}`);
    return modConfig;
  });

module.exports = withShortCmakeObjectPaths;
