'use client';

import { UserAccount } from '@blert/blertbank-client';
import TimeAgo from 'react-timeago';

import BlertcoinAmount from '@/components/blertcoin-amount';

import settingsStyles from '../style.module.scss';
import styles from './balance-section.module.scss';

type BalanceSectionProps = {
  account: UserAccount | null;
};

export default function BalanceSection({ account }: BalanceSectionProps) {
  return (
    <section className={settingsStyles.section}>
      <div className={settingsStyles.sectionHeader}>
        <h2>
          <i className="fas fa-wallet" />
          Your Balance
        </h2>
        <p className={settingsStyles.description}>
          Earn Blertcoins by recording raids and completing challenges.
        </p>
      </div>

      {account !== null ? (
        <div className={styles.balanceCard}>
          <div className={styles.balanceLabel}>
            <i className="fas fa-coins" />
            Available Balance
          </div>
          <div className={styles.balanceAmount}>
            <BlertcoinAmount amount={account.balance} />
          </div>
          <div className={styles.balanceSubtext}>
            Last change <TimeAgo date={account.updatedAt} live={false} />
          </div>
        </div>
      ) : (
        <div className={styles.errorCard}>
          <i className="fas fa-exclamation-triangle" />
          <div className={styles.errorMessage}>
            <strong>Unable to load balance</strong>
            <span>Please try again later.</span>
          </div>
        </div>
      )}

      <p className={styles.disclaimer}>
        Blertcoins are a virtual in-app currency used exclusively within Blert.
        They have no monetary value and cannot be exchanged for real currency,
        goods, or services.
      </p>
    </section>
  );
}
