'use client';

import { EquipmentMap } from '@blert/common';
import { useContext } from 'react';

import CollapsiblePanel from '../collapsible-panel';
import EquipmentViewer from '../equipment-viewer';
import Map, { Entity, EntityType, MapDefinition } from '../map';
import { ActorContext } from '../../raids/tob/context';

import styles from './styles.module.scss';

const MAP_TILE_SIZE = 30;

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
  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);
  const onEntitySelected = (entity: Entity) => {
    if (entity.type === EntityType.PLAYER) {
      setSelectedPlayer(entity.name);
    }
  };

  const toggleSelectedPlayer = (username: string) => {
    if (selectedPlayer === username) {
      setSelectedPlayer(null);
    } else {
      setSelectedPlayer(username);
    }
  };

  return (
    <CollapsiblePanel
      panelTitle="Room Replay"
      maxPanelHeight={1100}
      defaultExpanded={true}
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
          onEntityClicked={onEntitySelected}
        />

        <div className={styles.actors}>
          {Object.entries(playerDetails || {}).map(
            ([username, playerDetails]) => (
              <div
                role="button"
                className={`${styles.actor}${username === selectedPlayer ? ` ${styles.selected}` : ''}`}
                key={username}
                onClick={() => toggleSelectedPlayer(username)}
              >
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
