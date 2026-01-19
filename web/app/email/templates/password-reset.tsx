import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

import * as styles from './styles';

interface PasswordResetEmailProps {
  resetUrl: string;
}

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your Blert password</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.logoContainer}>
            <Img src={styles.LOGO_URL} alt="Blert" style={styles.logo} />
          </Section>
          <Heading style={styles.heading}>Reset Your Password</Heading>
          <Text style={styles.text}>
            We received a request to reset your Blert account password. Click
            the button below to choose a new password.
          </Text>
          <Section style={styles.buttonContainer}>
            <Button style={styles.button} href={resetUrl}>
              Reset Password
            </Button>
          </Section>
          <Text style={styles.text}>
            Or copy and paste this link into your browser:
          </Text>
          <Link style={styles.link} href={resetUrl}>
            {resetUrl}
          </Link>
          <Text style={styles.footer}>
            This link will expire in 1 hour. If you didn&apos;t request a
            password reset, you can safely ignore this email. Your password will
            remain unchanged.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
