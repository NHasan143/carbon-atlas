import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

/**
 * Correctness over style. `astro check` already type-checks, and the browser
 * tests already cover behaviour, so this exists to catch the things neither
 * can see: dead bindings, unreachable code, shadowed names, promises nobody
 * waits on, and accessibility mistakes in markup.
 *
 * Deliberately not enabled: stylistic rules. The client script in
 * AtlasDashboard.astro is written in a consistent `var`-and-`function` idiom
 * that predates this config; churning it would create a large diff with no
 * behavioural gain and would bury the findings that matter.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', '.astro/**', '.claude/**', '.impeccable/**', 'node_modules/**', 'public/**', 'test-results/**', 'playwright-report/**', '.venv/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-recommended'],

  {
    rules: {
      // Unused code is the main thing worth hearing about here. Arguments are
      // exempt: several callbacks take a signature they do not fully use.
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-unused-private-class-members': 'warn',
      // Real bugs rather than taste.
      eqeqeq: ['warn', 'smart'],
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'error',
      'no-template-curly-in-string': 'warn',
      // The codebase's own idiom; see the note above.
      'no-var': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['**/*.astro'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Client scripts inside .astro files are browser code.
  {
    files: ['**/*.astro/*.ts', '**/*.astro/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },

  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', '*.config.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
