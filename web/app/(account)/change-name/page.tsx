import { ChangeNameForm } from './change-name-form';

import styles from './style.module.scss';
import Link from 'next/link';

type ChangeNameProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function ChangeName({ searchParams }: ChangeNameProps) {
  const params = await searchParams;

  return (
    <div className={styles.changeName}>
      <h2>Change Name</h2>
      <p>Use this form to submit an in-game name change for an OSRS account.</p>
      <p>
        Most name changes process automatically. If yours doesn&apos;t, reach
        out on our <a href="https://discord.gg/c5Hgv3NnYe">Discord</a> for
        manual review.
      </p>
      <ChangeNameForm initialOldName={params.rsn} />
      <Link className={styles.return} href="/name-changes">
        Return to name changes
      </Link>
    </div>
  );
}
