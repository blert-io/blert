import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import hooksPlugin from 'eslint-plugin-react-hooks';
import rootConfig from '../eslint.config.mjs';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'public/scripts/graph-layout-worker.js',
    ],
  },
  ...rootConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: {
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': hooksPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // Next.js automatically imports React.
      'react/no-unknown-property': 'off', // Three.js uses custom properties.
      // Use the classic react-hooks rules instead of the new stricter ones.
      // TODO(frolv): Enable the stricter rules from eslint-plugin-react-hooks:
      // ...hooksPlugin.configs['recommended'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  // Web worker files
  {
    files: ['workers/**/*.mjs'],
    languageOptions: {
      globals: {
        self: 'readonly',
      },
    },
  },
];

export default config;
