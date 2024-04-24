import dotenv from 'dotenv';
import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

//@ts-ignore
global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

dotenv.config({ path: '.env.test' });
