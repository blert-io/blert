import '@testing-library/jest-dom';
import { loadEnvConfig } from '@next/env';
import { TextDecoder, TextEncoder } from 'util';

// TextDecoder/TextEncoder are not available in jsdom.
global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

loadEnvConfig(process.cwd());
