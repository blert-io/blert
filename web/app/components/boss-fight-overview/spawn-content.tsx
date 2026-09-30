import { ChallengeType, Stage, WaveSpawn } from '@blert/common';

import { ButtonLink } from '@/components/button';
import {
  encodeLosToolUrl,
  encodeTile,
  spawnQueryParam,
} from '@/utils/spawn-index';
import { queryString } from '@/utils/url';

import styles from './style.module.scss';

type SpawnContentProps = {
  type: ChallengeType;
  stage: Stage;
  spawn: WaveSpawn;
};

export function SpawnContent({ type, stage, spawn }: SpawnContentProps) {
  const baseNpcs = spawn.npcs.filter((npc) => encodeTile(type, npc) !== null);
  const searchUrl = `/search/challenges?${queryString({
    type,
    spawn: spawnQueryParam(stage, baseNpcs),
  })}`;
  const losToolUrl = encodeLosToolUrl({
    type,
    npcs: spawn.npcs,
    player: spawn.player,
  })!;

  return (
    <div className={styles.spawn}>
      <ButtonLink href={searchUrl}>
        <i className="fas fa-search" />
        Find similar spawns
      </ButtonLink>
      <ButtonLink
        href={losToolUrl}
        target="_blank"
        rel="noopener noreferrer"
        variant="neutral"
      >
        <i className="fas fa-external-link-alt" />
        View in{' '}
        {type === ChallengeType.COLOSSEUM ? 'Colosseum LOS' : 'Inferno LOS'}
      </ButtonLink>
    </div>
  );
}
