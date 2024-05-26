import '@testing-library/jest-dom';
import { loadEnvConfig } from '@next/env';
import { TextDecoder, TextEncoder } from 'util';

//@ts-ignore
global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

loadEnvConfig(process.cwd());
