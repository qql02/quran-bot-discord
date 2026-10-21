import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      // `catch {}` is used on purpose for best-effort cleanup; an empty `if`/loop body is still an error.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'no-duplicate-imports': 'error',
      'no-trailing-spaces': 'warn',
      'semi': ['warn', 'always']
    }
  },
  {
    // Dashboard scripts run in the browser.
    files: ['dashboard/admin/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser, Chart: 'readonly' }
    },
    rules: { 'eqeqeq': ['error', 'always', { null: 'ignore' }], 'no-undef': 'off', 'no-unused-vars': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] }
  },
  {
    files: ['test/**'],
    rules: { 'no-duplicate-imports': 'off', 'no-unused-vars': 'off' }
  },
  { ignores: ['node_modules/**', 'dashboard/admin/vendor/**'] }
];
