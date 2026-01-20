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

interface VerificationEmailProps {
  verificationUrl: string;
}

export function VerificationEmail({ verificationUrl }: VerificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Verify your email address</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.logoContainer}>
            <Img src={styles.LOGO_URL} alt="Blert" style={styles.logo} />
          </Section>
          <Heading style={styles.heading}>Verify Your Email</Heading>
          <Text style={styles.text}>
            Click the button below to verify your email address.
          </Text>
          <Section style={styles.buttonContainer}>
            <Button style={styles.button} href={verificationUrl}>
              Verify Email
            </Button>
          </Section>
          <Text style={styles.text}>
            Or copy and paste this link into your browser:
          </Text>
          <Link style={styles.link} href={verificationUrl}>
            {verificationUrl}
          </Link>
          <Text style={styles.footer}>
            This link will expire in 24 hours. If you didn&apos;t request this,
            you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
