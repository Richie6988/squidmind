'use strict';

/**
 * ESLint config — deliberately MINIMAL.
 *
 * This is not a style linter. It enables only the rules that would have
 * caught real bugs we shipped and then spent sessions hunting:
 *
 *  - no-dupe-keys           → the duplicate _ideTogglePreview in the
 *                             TempleInterior object literal that silently
 *                             overrode the working implementation.
 *  - no-dupe-class-members  → same failure mode for classes.
 *  - no-undef (server only) → `log is not defined` in voiceRoutes.
 *  - no-unreachable         → dead code after return/throw.
 *  - no-dupe-args           → duplicated function parameters.
 *
 * Everything stylistic is off. The goal is a lint run with ZERO noise so
 * a failure always means a real problem.
 */

const js = require('@eslint/js');

const commonRules = {
  'no-dupe-keys':          'error',
  'no-dupe-class-members': 'error',
  'no-dupe-args':          'error',
  'no-unreachable':        'error',
};

module.exports = [
  // Server: Node environment — no-undef is reliable here.
  {
    files: ['server/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', exports: 'writable',
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
        __dirname: 'readonly', __filename: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        fetch: 'readonly', AbortSignal: 'readonly', AbortController: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
        global: 'writable', structuredClone: 'readonly',
        setImmediate: 'readonly', clearImmediate: 'readonly',
        FormData: 'readonly', Blob: 'readonly', Headers: 'readonly', Response: 'readonly', Request: 'readonly',
      },
    },
    rules: { ...commonRules, 'no-undef': 'error' },
  },
  // Client: browser scripts define/use cross-file globals liberally, so
  // no-undef would be all false positives. Keep the structural rules only.
  {
    files: ['client/scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
    },
    rules: { ...commonRules },
  },
];
