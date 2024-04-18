import styles from './style.module.scss';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className={styles.accountPage}>{children}</div>;
}
