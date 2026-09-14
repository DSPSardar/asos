// ESLint 9 flat config. Node 22 / CommonJS backend — see CLAUDE.md.
'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Callers frequently keep a named `_next` / `_err` for signature clarity.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // The codebase carries `eslint-disable no-await-in-loop` comments from a
    // config that never landed; that rule is not in recommended, so don't
    // flag the now-inert directives.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  { ignores: ['node_modules/', 'prisma/migrations/'] },
];
