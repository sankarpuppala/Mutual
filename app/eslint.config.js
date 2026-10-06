/**
 * Lint rules that enforce the architecture, not just style (SPEC.md §13.8, CLAUDE.md §6).
 *
 * Two rules exist for privacy rather than taste, and both are also checked independently by
 * `scripts/check-privacy-invariants.ts` so that disabling one here is not enough to ship:
 *   - network access only through `src/api/client.ts` (invariant 1);
 *   - no raw colour literals in routes or components, so every colour comes from
 *     `src/design/tokens.ts` and therefore exists in both themes (SPEC §13.4).
 */

const expoConfig = require('eslint-config-expo/flat');

/** Matches #rgb, #rrggbb and #rrggbbaa. */
const HEX_COLOUR = String.raw`^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`;

module.exports = [
  ...expoConfig,
  {
    ignores: ['node_modules/**', '.expo/**', 'android/**', 'ios/**', 'expo-env.d.ts'],
  },
  {
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Network access goes through src/api/client.ts only (CLAUDE.md invariant 1).',
        },
        {
          name: 'XMLHttpRequest',
          message: 'Network access goes through src/api/client.ts only (CLAUDE.md invariant 1).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='XMLHttpRequest']",
          message: 'Network access goes through src/api/client.ts only (CLAUDE.md invariant 1).',
        },
        {
          selector: "MemberExpression[object.name='global'][property.name='fetch']",
          message: 'Network access goes through src/api/client.ts only (CLAUDE.md invariant 1).',
        },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The one file allowed to touch the network.
    files: ['src/api/client.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // Routes and components take every colour from the design tokens.
    files: ['app/**/*.tsx', 'app/**/*.ts', 'src/components/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${HEX_COLOUR}/]`,
          message:
            'No raw colours here: import from src/design/tokens.ts so the value exists in both themes (SPEC §13.4).',
        },
        {
          selector: "NewExpression[callee.name='XMLHttpRequest']",
          message: 'Network access goes through src/api/client.ts only (CLAUDE.md invariant 1).',
        },
      ],
    },
  },
  {
    // Scripts and tests run on Node, outside the app bundle.
    files: ['scripts/**/*.ts', '__tests__/**/*.ts', '__tests__/**/*.tsx', '*.config.js'],
    // Scripts read files and print; tests replace global.fetch to assert what the client
    // sends. Neither is app code, and neither ships.
    rules: {
      'no-console': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
