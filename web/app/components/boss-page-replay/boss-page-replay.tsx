'use client';

import { useContext } from 'react';

import CollapsiblePanel from '../collapsible-panel';
import EquipmentViewer from '../equipment-viewer';
import KeyPrayers from '../key-prayers';
import Map, { Entity, EntityType, MapDefinition } from '../map';
import { ActorContext } from '../../raids/tob/context';
import { PlayerState } from '../../utils/boss-room-state';

import styles from './styles.module.scss';

const DEFAULT_MAP_TILE_SIZE = 30;

type BossReplayProps = {
  entities: Entity[];
  mapDef: MapDefinition;
  playerTickState: Record<string, PlayerState | null>;
  tileSize?: number;
};

export default function BossPageReplay({
  entities,
  mapDef,
  playerTickState,
  tileSize = DEFAULT_MAP_TILE_SIZE,
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
      maxPanelHeight={2000}
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
          tileSize={tileSize}
          entities={entities}
          onEntityClicked={onEntitySelected}
        />

        <div className={styles.actors}>
          {Object.entries(playerTickState).map(([username, state]) => (
            <div
              role="button"
              className={`${styles.actor}${username === selectedPlayer ? ` ${styles.selected}` : ''}`}
              key={username}
              onClick={() => toggleSelectedPlayer(username)}
            >
              <h2>{username}</h2>
              <KeyPrayers prayerSet={state?.player.prayerSet || 0} />
              <EquipmentViewer equipment={state?.player.equipment ?? null} />
            </div>
          ))}
        </div>
      </div>
    </CollapsiblePanel>
  );
}
