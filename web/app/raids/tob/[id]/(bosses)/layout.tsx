import styles from './style.module.scss';

type BossLayoutProps = {
  children: React.ReactNode;
};

export default function BossLayout({ children }: BossLayoutProps) {
  return (
    <div className={styles.bossPage}>
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
