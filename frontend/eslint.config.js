import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '@/']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-console': ['warn', { allow: ['error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // React Compiler rules — downgrade to warn: these fire on valid patterns like
      // initializing state in useEffect (dialog reset) and react-hook-form watch().
      // They are advisory, not correctness errors, and fixing them all would require
      // a major refactor of every dialog component.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  // Test utilities export both components and non-components — fast-refresh irrelevant
  {
    files: ['src/test/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/__mocks__/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // UI library files — generated primitives that export constants/types alongside components
  // and use spread props that confuse static analysis rules
  {
    files: ['src/components/ui/button.tsx', 'src/components/ui/badge.tsx', 'src/components/ui/card.tsx', 'src/components/ui/form.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
      // card.tsx uses {...props} spread which passes children; linter can't verify statically
      'jsx-a11y/heading-has-content': 'off',
    },
  },
  // Hooks/contexts that intentionally export non-component utilities alongside components
  {
    files: ['src/hooks/use-toast.ts', 'src/lib/logger.ts', 'src/contexts/WebSocketContext.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
