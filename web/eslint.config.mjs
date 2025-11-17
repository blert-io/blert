import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
// import rootConfig from '../eslint.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// TODO(frolv): Enable full rootConfig lint incrementally (currently 539 errors).
export default [
  // ...rootConfig,
  ...compat.extends('next/core-web-vitals'),
];
