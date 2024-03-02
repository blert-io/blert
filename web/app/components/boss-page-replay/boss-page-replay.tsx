'use client';

import CollapsiblePanel from '../collapsible-panel';
import Map, { Entity, MapDefinition } from '../map';

import styles from './styles.module.scss';

const MAP_TILE_SIZE = 35;

type BossReplayProps = {
  entities: Entity[];
  mapDef: MapDefinition;
};

export default function BossPageReplay({ entities, mapDef }: BossReplayProps) {
  return (
    <CollapsiblePanel
      panelTitle="Room Replay"
      maxPanelHeight={1000}
      defaultExpanded={true}
      className={styles.replay}
    >
      <div className={styles.replay}>
        <Map
          x={mapDef.baseX}
          y={mapDef.baseY}
          width={mapDef.width}
          height={mapDef.height}
          baseTiles={mapDef.baseTiles}
          faceSouth={mapDef.faceSouth}
          tileSize={MAP_TILE_SIZE}
          entities={entities}
          // onEntityClicked={onEntitySelected}
        />
      </div>
    </CollapsiblePanel>
  );
}
