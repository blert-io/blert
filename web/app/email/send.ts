import { resend, BASE_URL, FROM_EMAIL, REPLY_TO_EMAIL } from './client';
import { VerificationEmail } from './templates/verification';
import { PasswordResetEmail } from './templates/password-reset';
import { EmailChangeEmail } from './templates/email-change';

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const verificationUrl = `${BASE_URL}/verify-email?token=${token}`;

  if (resend === null) {
    console.warn('Resend not configured, skipping verification email to', to);
    console.warn('Verification URL:', verificationUrl);
    return;
  }

  await resend.emails.send({
    from: `Blert <${FROM_EMAIL}>`,
    replyTo: REPLY_TO_EMAIL,
    to,
    subject: 'Verify your Blert account',
    react: VerificationEmail({ verificationUrl }),
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`;

  if (resend === null) {
    console.warn('Resend not configured, skipping password reset email to', to);
    console.warn('Reset URL:', resetUrl);
    return;
  }

  await resend.emails.send({
    from: `Blert <${FROM_EMAIL}>`,
    replyTo: REPLY_TO_EMAIL,
    to,
    subject: 'Reset your Blert password',
    react: PasswordResetEmail({ resetUrl }),
  });
}

export async function sendEmailChangeEmail(
  to: string,
  token: string,
): Promise<void> {
  const verificationUrl = `${BASE_URL}/verify-email-change?token=${token}`;

  if (resend === null) {
    console.warn('Resend not configured, skipping email change email to', to);
    console.warn('Verification URL:', verificationUrl);
    return;
  }

  await resend.emails.send({
    from: `Blert <${FROM_EMAIL}>`,
    replyTo: REPLY_TO_EMAIL,
    to,
    subject: 'Confirm your new Blert email address',
    react: EmailChangeEmail({ verificationUrl }),
  });
}
