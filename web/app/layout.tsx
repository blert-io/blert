import type { Metadata } from 'next';

import { Inter } from 'next/font/google';

import Image from 'next/image';

import Link from 'next/link';

import playerImg from '/public/player.png';

import connectToDatabase from './actions/db';

import './globals.scss';

import styles from './styles.module.scss';

connectToDatabase();

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
        <div className={styles.siteParent}>
          <div className={styles.leftNav}>
            <div className={styles.leftNav__logo}>
              <Link href="/">
                <Image
                  src="/blert-topbar.png"
                  alt="blert logo"
                  height={200}
                  width={200}
                />
              </Link>
            </div>
            <ul className={styles.leftNav__menu}>
              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <Image
                      src="/home.webp"
                      alt="home icon"
                      height={35}
                      width={35}
                    />
                  </div>

                  <span className="active">Home</span>
                </Link>
              </li>

              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <i className="fa-solid fa-magnifying-glass"></i>
                  </div>

                  <span className="active">Search</span>
                </Link>
              </li>

              <div className={styles.leftNav__menuDivider}></div>

              {/* <div className={styles.leftNav__menuDividerTitle}>Raids</div> */}

              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <Image
                      src="/logo_tob.webp"
                      alt="tob icon"
                      height={40}
                      width={40}
                    />
                  </div>
                  <span className="active">ToB</span>
                </Link>
              </li>

              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <Image
                      src="/logo_cox.webp"
                      alt="cox icon"
                      height={40}
                      width={40}
                    />
                  </div>
                  <span className="active">CoX</span>
                </Link>
              </li>

              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <Image
                      src="/logo_toa.webp"
                      alt="toa icon"
                      height={40}
                      width={40}
                    />
                  </div>
                  <span className="active">ToA</span>
                </Link>
              </li>

              <div className={styles.leftNav__menuDividerTwo}></div>

              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <Image
                      className={styles.leftNav__playerIcon}
                      src={playerImg}
                      alt="player icon"
                    />
                  </div>

                  <span className="active">Players</span>
                </Link>
              </li>

              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <i className="fa-solid fa-arrow-trend-up"></i>
                  </div>

                  <span className="active">Trends</span>
                </Link>
              </li>

              <li className={styles.leftNav__menuItem}>
                <Link className={styles.leftNav__menuItemInner} href="/raids">
                  <div className={styles.leftNav__menuItemIcon}>
                    <i className="fa-solid fa-user-ninja"></i>
                  </div>

                  <span className="active">Account</span>
                </Link>
              </li>
            </ul>

            <div className={styles.leftNav__externalLinks}>
              <div className={styles.leftNav__externalLink}>
                <Link
                  href="https://discord.gg/yWD6KGuG"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <i className="fa-brands fa-discord"></i>
                </Link>
              </div>
              {/* <div className={styles.leftNav__externalLink}>
                <i className="fa-brands fa-twitter"></i>
              </div>
              <div className={styles.leftNav__externalLink}>
                <i className="fa-brands fa-patreon"></i>
              </div> */}
              <div className={styles.leftNav__externalLink}>
                <Link
                  href="https://github.com/blert-io"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <i className="fa-brands fa-github"></i>
                </Link>
              </div>
            </div>
          </div>

          <div className={styles.pageParentContent}>{children}</div>
        </div>
      </body>
    </html>
  );
}
