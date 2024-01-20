import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';
import styles from './styles.module.css';
import Link from 'next/link';
import Image from 'next/image';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'blert',
  description: 'Theater of Blood Raid Tracker',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className={styles.topbar}>
          <Link href="/">
            <Image
              src="/blert-topbar.png"
              alt="blert logo"
              width={70}
              height={70}
            />
          </Link>
        </div>
        <div className={styles.content}>{children}</div>
      </body>
    </html>
  );
}
