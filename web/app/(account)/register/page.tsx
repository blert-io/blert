import Link from 'next/link';

import RegisterForm from './register-form';

import styles from './style.module.scss';

export default function Register() {
  return (
    <div className={styles.registerPanel}>
      <h1>Welcome to Blert!</h1>
      <RegisterForm />
      <Link className={styles.login} href="/login">
        Already have an account? Log in
      </Link>
    </div>
  );
}

export const metadata = {
  title: 'Register | Blert',
  description: "Sign up for Old School Runescape's premium PvM analytics tool.",
};
