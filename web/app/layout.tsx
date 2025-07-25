import { GoogleAnalytics } from '@next/third-parties/google';
import { Metadata } from 'next';
import { Cinzel, Inter, Roboto_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import { SessionProvider } from 'next-auth/react';
import { WebSite, WithContext } from 'schema-dts';

import LeftNav from './components/left-nav';
import ToastProvider from './components/toast';
import Tooltip, { GLOBAL_TOOLTIP_ID } from './components/tooltip';
import Topbar from './components/topbar';
import ChallengeProvider from './challenge-context';
import { DisplayWrapper } from './display';
import { MAIN_LOGO } from './logo';
import Styler from './styler';

import './globals.scss';
import styles from './styles.module.scss';

const runescape = localFont({
  src: [
    {
      path: '../public/fonts/runescape.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/runescape-bold.ttf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-runescape',
});

const cinzel = Cinzel({ subsets: ['latin'], variable: '--font-cinzel' });
const inter = Inter({ subsets: ['latin'] });
const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-roboto-mono',
});

const jsonLd: WithContext<WebSite> = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  url: 'https://blert.io',
  name: 'Blert',
  description: 'Old School Runescape PvM Analytics',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://blert.io'),
  title: {
    default: 'Blert',
    template: '%s | Blert',
  },
  description: 'Old School Runescape PvM Analytics',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://blert.io',
    siteName: 'Blert',
    description: 'Old School Runescape PvM Analytics',
    images: [
      {
        url: `https://blert.io/${MAIN_LOGO}`,
        width: 530,
        height: 342,
        alt: 'Blert',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Blert',
    description: 'Old School Runescape PvM Analytics',
    images: [`https://blert.io/${MAIN_LOGO}`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${styles.body} ${cinzel.variable} ${inter.className} ${robotoMono.variable} ${runescape.variable}`}
        style={{ overflowX: 'hidden' }}
      >
        <Styler />
        <SessionProvider>
          <DisplayWrapper>
            <ChallengeProvider>
              <ToastProvider>
                <Topbar />
                <div className={styles.siteParent}>
                  <LeftNav />
                  <div id="portal-root" />
                  <div className={styles.pageParentContent}>{children}</div>
                </div>
              </ToastProvider>
            </ChallengeProvider>
          </DisplayWrapper>
        </SessionProvider>
        <Tooltip maxWidth={360} tooltipId={GLOBAL_TOOLTIP_ID}>
          <div />
        </Tooltip>
      </body>
      {process.env.NODE_ENV === 'production' && (
        <GoogleAnalytics gaId="G-5W75H2B3LF" />
      )}
    </html>
  );
}
