import { Inter } from 'next/font/google';

import './globals.scss';

import { LeftNav } from './components/left-nav/left-nav';
import Topbar from './components/topbar';
import { DisplayWrapper } from './display';
import Styler from './styler';

import styles from './styles.module.scss';
import { Metadata } from 'next';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className} style={{ overflowX: 'hidden' }}>
        <Styler />
        <DisplayWrapper>
          <Topbar />
          <div className={styles.siteParent}>
            <LeftNav />
            <div id="tooltip-portal" />
            <div className={styles.pageParentContent}>{children}</div>
          </div>
        </DisplayWrapper>
      </body>
    </html>
  );
}

export const metadata: Metadata = {
  title: 'Blert',
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
    card: 'summary_large_image',
    title: 'Blert',
    description: 'Old School Runescape PvM Analytics',
    images: ['https://blert.io/images/blert-topbar.png'],
  },
};
