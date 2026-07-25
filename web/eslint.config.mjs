import nextPlugin from '@next/eslint-plugin-next';
import nextConfig from 'eslint-config-next';
import hooksPlugin from 'eslint-plugin-react-hooks';
import { createRequire } from 'node:module';
import rootConfig from '../eslint.config.mjs';

// eslint-plugin-react's `version: 'detect'` calls `context.getFilename()`,
// which ESLint 10 removed, so the React version must be supplied explicitly.
// TODO(frolv): Remove these two workarounds once eslint-plugin-react updates.
// https://github.com/jsx-eslint/eslint-plugin-react/issues/3977
const reactVersion = createRequire(import.meta.url)(
  'react/package.json',
).version;

// eslint-plugin-react does not yet support ESLint 10, so npm nests it under
// eslint-config-next instead of hoisting it, leaving it unresolvable from here.
// Read the plugin off eslint-config-next, which owns the dependency.
const reactPlugin = nextConfig.find(
  (entry) => entry.plugins?.react !== undefined,
).plugins.react;

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
        version: reactVersion,
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
