import styles from './style.module.scss';

export default function SectionTitle({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className={styles.sectionTitle}>
      <i className={`fas ${icon}`} />
      {children}
    </h3>
  );
}
