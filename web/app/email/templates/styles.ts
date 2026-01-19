export const LOGO_URL = 'https://blert.io/images/blert.png';

export const main = {
  backgroundColor: '#212229',
  fontFamily:
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

export const container = {
  margin: '0 auto',
  padding: '40px 20px',
  maxWidth: '480px',
};

export const logoContainer = {
  textAlign: 'center' as const,
  marginBottom: '24px',
};

export const logo = {
  width: '120px',
  height: 'auto',
  margin: '0 auto',
  display: 'block',
};

export const heading = {
  color: '#c3c7c9',
  fontSize: '24px',
  fontWeight: '700',
  marginBottom: '24px',
  textAlign: 'center' as const,
};

export const text = {
  color: '#c3c7c9',
  fontSize: '16px',
  lineHeight: '24px',
  marginBottom: '16px',
};

export const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

export const button = {
  backgroundColor: '#5865f2',
  color: '#ffffff',
  padding: '14px 28px',
  borderRadius: '6px',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '16px',
  display: 'inline-block',
};

export const link = {
  color: '#5865f2',
  fontSize: '14px',
  wordBreak: 'break-all' as const,
  marginBottom: '16px',
  display: 'block',
};

export const footer = {
  color: '#5e6288',
  fontSize: '14px',
  marginTop: '32px',
  lineHeight: '20px',
};
