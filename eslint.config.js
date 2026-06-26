const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // node: gives ESLint knowledge of Node.js globals (require, process, __dirname…)
        // jest: gives ESLint knowledge of test globals (describe, it, expect…)
        // Without these, ESLint would flag every Node/Jest global as "undefined".
        ...globals.node,
        ...globals.jest,
        // CAP injects these as globals at runtime; ESLint must be told they exist.
        SELECT: 'readonly',
        INSERT: 'readonly',
        UPDATE: 'readonly',
        DELETE: 'readonly',
        UPSERT: 'readonly',
      },
    },
    rules: {
      // warn instead of error so unused vars surface in CI output without
      // blocking the build during active development. Tighten to 'error'
      // before the first production release.
      'no-unused-vars': 'warn',
    },
  },
  // prettierConfig must come last: it disables all ESLint formatting rules so
  // Prettier owns formatting and ESLint owns logic — the two never conflict.
  prettierConfig,
  {
    // CAP and build tools generate these directories at runtime. Linting
    // generated code produces false positives and hides real issues.
    ignores: ['node_modules/', 'gen/', 'coverage/', '.cds_gen/'],
  },
];
