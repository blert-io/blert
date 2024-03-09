import { Inter } from 'next/font/google';

import connectToDatabase from './actions/db';

import './globals.scss';

import styles from './styles.module.scss';
import { LeftNav } from './components/left-nav/left-nav';

connectToDatabase();

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className={styles.siteParent}>
          <LeftNav />
          <div id="tooltip-portal" />
          <div className={styles.pageParentContent}>{children}</div>
        </div>
      </body>
    </html>
  );
}
