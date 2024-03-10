'use client';

import { EquipmentMap } from '@blert/common';
import CollapsiblePanel from '../collapsible-panel';

import EquipmentViewer from '../equipment-viewer';
import Map, { Entity, MapDefinition } from '../map';

import styles from './styles.module.scss';

const MAP_TILE_SIZE = 35;

export type PlayerDetails = {
  [username: string]: { equipment?: Partial<EquipmentMap> };
};

type BossReplayProps = {
  entities: Entity[];
  mapDef: MapDefinition;
  playerDetails?: PlayerDetails;
};

export default function BossPageReplay({
  entities,
  mapDef,
  playerDetails,
}: BossReplayProps) {
  return (
    <CollapsiblePanel
      panelTitle="Room Replay"
      maxPanelHeight={1100}
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

        <div className={styles.actors}>
          {Object.entries(playerDetails || {}).map(
            ([username, playerDetails]) => (
              <div className={styles.actor} key={username}>
                <h2>{username}</h2>
                {playerDetails.equipment && (
                  <EquipmentViewer equipment={playerDetails.equipment} />
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </CollapsiblePanel>
  );
}
