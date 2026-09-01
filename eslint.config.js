import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // design/ mirrors the approved Claude Design source and docs/ holds design
    // artefacts; both are reference material, not project code.
    ignores: ['dist', 'node_modules', 'vendor', '.wrangler', 'public/catalog', 'design', 'docs'],
  },
  js.configs.recommended,
  {
    // Type-aware linting is scoped to TypeScript. Applying it to plain .js
    // (this config file included) throws, because those files are in no tsconfig.
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['pipeline/**/*.ts', 'scripts/**/*.ts', 'tools/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Workers run in neither the browser nor Node: no `window`, no `process`,
    // but `fetch`, `Response` and `caches` are ambient.
    files: ['workers/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
  },
)
