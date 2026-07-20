//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    // src/integrations/supabase/{types,auth-middleware}.ts are Supabase codegen
    // ("automatically generated. Do not edit it directly.") — hand-editing them
    // is forbidden, and auth-middleware.ts is unused generated boilerplate.
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'src/integrations/supabase/types.ts',
      'src/integrations/supabase/auth-middleware.ts',
      // Capacitor sub-projects lint with their own config.
      'apps/**',
      // Build artifacts — never lint generated output.
      '.output/**',
      'dist/**',
      'dist-ssr/**',
      // Static assets served as-is (not part of the TS project).
      'public/**',
    ],
  },
]
