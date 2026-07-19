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
    // src/integrations/supabase/types.ts is Supabase codegen ("automatically
    // generated. Do not edit it directly.") — its type-parameter names violate
    // our naming-convention rule and must not be hand-edited.
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'src/integrations/supabase/types.ts',
    ],
  },
]
