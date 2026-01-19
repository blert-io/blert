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

interface EmailChangeEmailProps {
  verificationUrl: string;
}

export function EmailChangeEmail({ verificationUrl }: EmailChangeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Confirm your new Blert email address</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.logoContainer}>
            <Img src={styles.LOGO_URL} alt="Blert" style={styles.logo} />
          </Section>
          <Heading style={styles.heading}>Confirm Your New Email</Heading>
          <Text style={styles.text}>
            You requested to change the email address on your Blert account to
            this address. Click the button below to confirm this change.
          </Text>
          <Section style={styles.buttonContainer}>
            <Button style={styles.button} href={verificationUrl}>
              Confirm Email Change
            </Button>
          </Section>
          <Text style={styles.text}>
            Or copy and paste this link into your browser:
          </Text>
          <Link style={styles.link} href={verificationUrl}>
            {verificationUrl}
          </Link>
          <Text style={styles.footer}>
            This link will expire in 24 hours. If you didn&apos;t request this
            change, you can safely ignore this email. Your email address will
            remain unchanged.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
