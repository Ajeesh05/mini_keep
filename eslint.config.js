import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**']
  },
  {
    // Extension source: a classic MV3 service worker, not a module.
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.webextensions }
    },
    rules: {
      'no-undef': 'error',
      // Warn, not error: dead code is a finding for the audit scanner to
      // propose removing, not a reason to block every build.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-implicit-globals': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      // Security: flags the innerHTML-style sinks the audit scanner cares about.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  }
]
