import PasswordChangeForm from './password-change-form';

import styles from '../style.module.scss';

export default function PasswordSection() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>Change Password</h2>
        <p className={styles.description}>
          Update your account password. You&apos;ll need to enter your current
          password to confirm the change.
        </p>
      </div>

      <div className={styles.passwordForm}>
        <PasswordChangeForm />
      </div>
    </section>
  );
}
