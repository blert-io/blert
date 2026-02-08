import { ResolvingMetadata } from 'next';

import { basicMetadata } from '@/utils/metadata';

import { MdxGuide } from '../../mdx-guide';

import styles from '../style.module.scss';

import content from './content.mdx';

export default function BlertInstallGuide() {
  return <MdxGuide source={content} className={styles.blertGuide} />;
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'How to Install Blert',
    description:
      'Step-by-step guide to installing the Blert plugin for Old School RuneScape ' +
      'PvM tracking. Learn how to set up a developer RuneLite client and get Blert ' +
      'running in minutes.',
  });
}
