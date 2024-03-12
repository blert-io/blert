import { Inter } from 'next/font/google';

import './globals.scss';

import styles from './styles.module.scss';
import { LeftNav } from './components/left-nav/left-nav';
import Styler from './styler';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body className={inter.className}>
        <Styler />
        <div className={styles.siteParent}>
          <LeftNav />
          <div id="tooltip-portal" />
          <div className={styles.pageParentContent}>{children}</div>
        </div>
      </body>
    </html>
  );
}
