import styles from './style.module.scss';

/**
 * Wrapper around controls for the map (settings/buttons/etc).
 */
export default function MapControlsSection({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.mapControlsSection}>{children}</div>;
}
