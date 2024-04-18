import Link from 'next/link';
import LoginForm from './login-form';

import styles from './style.module.scss';

export default function Login() {
  return (
    <div className={styles.loginPanel}>
      <h1>Sign in to Blert</h1>
      <LoginForm />
      <Link className={styles.register} href="/register">
        Don't have an account? Register
      </Link>
    </div>
  );
}

export const metadata = {
  title: 'Login | Blert',
  description: 'Login to your Blert account',
};
