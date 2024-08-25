import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import Article from '@/components/article';
import GuideTags from '@/guides/guide-tags';
import { basicMetadata } from '@/utils/metadata';

import RoleLinks from './role-links';
import Image from 'next/image';

export default function NyloGuide() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="4s Nylocas Waves" />
      <em>
        Contributed by the{' '}
        <Link
          href="https://discord.gg/u6yXPrFFsf"
          target="_blank"
          rel="noreferrer noopener"
        >
          Money Tobs Discord
        </Link>
        , where you can find additional resources on max-eff ToB and teammates
        to raid with.
      </em>
      <GuideTags challenge={ChallengeType.TOB} scale={4} level="max-eff" />
      <Image
        src="/nyloking.webp"
        alt="Nylocas"
        height={250}
        width={250}
        style={{ objectFit: 'contain' }}
      />
      <p>
        This guide is part of Blert’s series of max-eff Theatre of Blood 4s
        guides. It is intended for players who already have a basic knowledge of
        the Theatre of Blood and are looking to learn how to run efficient
        raids.
      </p>
      <p>
        Within the Nylocas waves guide, you can find wave-by-wave breakdowns of
        optimal rotations for each role, complete with detailed explanations and
        POV videos.
      </p>
      <p>Select a role below to get started.</p>
      <RoleLinks />
    </Article.Page>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: '4s Nylocas Waves Guide',
    description:
      'Learn efficient Nylocas waves rotations for every role in a Theatre of Blood 4s raid.',
  });
}
