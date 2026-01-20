import { resend, FROM_EMAIL, REPLY_TO_EMAIL } from './client';
import { VerificationEmail } from './templates/verification';
import { PasswordResetEmail } from './templates/password-reset';

export async function sendVerificationEmail(
  to: string,
  url: string,
): Promise<void> {
  if (resend === null) {
    console.warn('Resend not configured, skipping verification email to', to);
    console.warn('Verification URL:', url);
    return;
  }

  await resend.emails.send({
    from: `Blert <${FROM_EMAIL}>`,
    replyTo: REPLY_TO_EMAIL,
    to,
    subject: 'Verify your Blert email address',
    react: VerificationEmail({ verificationUrl: url }),
  });
}

export async function sendPasswordResetEmail(
  to: string,
  url: string,
): Promise<void> {
  if (resend === null) {
    console.warn('Resend not configured, skipping password reset email to', to);
    console.warn('Reset URL:', url);
    return;
  }

  await resend.emails.send({
    from: `Blert <${FROM_EMAIL}>`,
    replyTo: REPLY_TO_EMAIL,
    to,
    subject: 'Reset your Blert password',
    react: PasswordResetEmail({ resetUrl: url }),
  });
}
