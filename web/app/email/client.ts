import { Resend } from 'resend';

const apiKey = process.env.BLERT_RESEND_API_KEY;

if (!apiKey) {
  console.warn(
    'RESEND_API_KEY is not set. Email functionality will be disabled.',
  );
}

export const resend = apiKey ? new Resend(apiKey) : null;

export const FROM_EMAIL =
  process.env.BLERT_RESEND_FROM_EMAIL ?? 'notifications@blert.io';
export const REPLY_TO_EMAIL =
  process.env.BLERT_RESEND_REPLY_TO_EMAIL ?? 'support@blert.io';
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://blert.io';
