import { Metadata } from 'next';
import { Inter, Roboto_Mono } from 'next/font/google';
import { SessionProvider } from 'next-auth/react';
import { WebSite, WithContext } from 'schema-dts';

import LeftNav from './components/left-nav';
import Topbar from './components/topbar';
import ChallengeProvider from './challenge-context';
import { DisplayWrapper } from './display';
import Styler from './styler';

import './globals.scss';
import styles from './styles.module.scss';

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
        url: 'https://blert.io/images/blert-topbar.png',
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
    images: ['https://blert.io/images/blert-topbar.png'],
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
        className={`${inter.className} ${robotoMono.variable}`}
        style={{ overflowX: 'hidden' }}
      >
        <Styler />
        <SessionProvider>
          <DisplayWrapper>
            <ChallengeProvider>
              <Topbar />
              <div className={styles.siteParent}>
                <LeftNav />
                <div id="portal-root" />
                <div className={styles.pageParentContent}>{children}</div>
              </div>
            </ChallengeProvider>
          </DisplayWrapper>
        </SessionProvider>
      </body>
    </html>
  );
}
