import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import Card, { CardLink } from '@/components/card';
import { basicMetadata } from '@/utils/metadata';

import { ChangeNameForm } from './change-name-form';

import styles from './style.module.scss';

type ChangeNameProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function ChangeName({ searchParams }: ChangeNameProps) {
  const params = await searchParams;

  return (
    <div className={styles.nameChangePage}>
      <Card className={styles.formPanel}>
        <h1>Submit Name Change</h1>
        <p className={styles.subtitle}>
          Report a change in your OSRS account name to keep your Blert history
          connected. Most name changes process automatically. If yours
          doesn&apos;t, reach out on our{' '}
          <Link
            href="https://discord.gg/c5Hgv3NnYe"
            target="_blank"
            rel="noreferrer noopener"
          >
            Discord
          </Link>{' '}
          for manual review.
        </p>
        <ChangeNameForm initialOldName={params.rsn} />
        <CardLink href="/name-changes" text="Return to name changes" />
      </Card>
    </div>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Submit Name Change',
    description: 'Report a change in your OSRS account name.',
  });
}

export const dynamic = 'force-dynamic';
