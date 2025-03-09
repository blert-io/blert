'use client';

import { useContext } from 'react';

import Card from '@/components/card';
import Map, { Entity, EntityType, MapDefinition } from '@/components/map';
import { ActorContext } from '@/raids/tob/context';

import styles from './styles.module.scss';

const DEFAULT_MAP_TILE_SIZE = 25;

type BossReplayProps = {
  entities: Entity[];
  mapDef: MapDefinition;
  tileSize?: number;
};

export default function BossPageReplay({
  entities,
  mapDef,
  tileSize = DEFAULT_MAP_TILE_SIZE,
}: BossReplayProps) {
  const { setSelectedPlayer } = useContext(ActorContext);
  const onEntitySelected = (entity: Entity) => {
    if (entity.type === EntityType.PLAYER) {
      setSelectedPlayer(entity.name);
    }
  };

  return (
    <Card header={{ title: 'Room Replay' }} className={styles.replay}>
      <Map
        x={mapDef.baseX}
        y={mapDef.baseY}
        width={mapDef.width}
        height={mapDef.height}
        baseTiles={mapDef.baseTiles}
        faceSouth={mapDef.faceSouth}
        tileSize={tileSize}
        entities={entities}
        onEntityClicked={onEntitySelected}
      />
    </Card>
  );
}
