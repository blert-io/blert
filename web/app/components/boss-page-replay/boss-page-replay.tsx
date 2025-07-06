'use client';

import { useCallback, useContext, useState } from 'react';

import Card from '@/components/card';
import LegacyMap, {
  Entity as LegacyEntity,
  EntityType as LegacyEntityType,
  MapDefinition as LegacyMapDefinition,
} from '@/components/map';
import {
  AnyEntity,
  CameraResetButton,
  CustomButton,
  EntityType,
  Map,
  MapCanvas,
  MapControlsSection,
  MapDefinition,
  MapSettings,
  NpcEntity,
  ReplayClock,
} from '@/components/map-renderer';
import Modal from '@/components/modal';
import { ActorContext } from '@/(challenges)/raids/tob/context';

import styles from './styles.module.scss';

const DEFAULT_MAP_TILE_SIZE = 25;

type LegacyBossReplayProps = {
  entities: LegacyEntity[];
  mapDef: LegacyMapDefinition;
  tileSize?: number;
};

export default function LegacyBossPageReplay({
  entities,
  mapDef,
  tileSize = DEFAULT_MAP_TILE_SIZE,
}: LegacyBossReplayProps) {
  const { setSelectedPlayer } = useContext(ActorContext);
  const onEntitySelected = (entity: LegacyEntity) => {
    if (entity.type === LegacyEntityType.PLAYER) {
      setSelectedPlayer(entity.name);
    }
  };

  return (
    <Card header={{ title: 'Room Replay' }} className={styles.replay}>
      <LegacyMap
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

type BossReplayProps = {
  entities: AnyEntity[];
  mapDef: MapDefinition;
  playing: boolean;
  width: number | string;
  height: number | string;
  currentTick: number;
  advanceTick: () => void;
  setUseLegacy: () => void;
};

export function BossPageReplay({
  entities,
  mapDef,
  playing,
  width,
  height,
  currentTick,
  advanceTick,
  setUseLegacy,
}: BossReplayProps) {
  const [config, setConfig] = useState({
    interpolationEnabled: true,
    tickDuration: 600,
    debug: false,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);

  // TODO(frolv): Switch to using a single selected entity.
  const {
    selectedPlayer,
    setSelectedPlayer,
    selectedRoomNpc,
    setSelectedRoomNpc,
  } = useContext(ActorContext);

  const selectedEntity = selectedPlayer
    ? entities.find(
        (entity) =>
          entity.type === EntityType.PLAYER && entity.name === selectedPlayer,
      )
    : selectedRoomNpc
      ? entities.find(
          (entity) =>
            entity.type === EntityType.NPC &&
            (entity as NpcEntity).roomId === selectedRoomNpc,
        )
      : null;

  const onEntitySelected = useCallback(
    (entity: AnyEntity | null) => {
      if (entity === null) {
        setSelectedRoomNpc(null);
        setSelectedPlayer(null);
        return;
      }

      if (entity.type === EntityType.PLAYER) {
        setSelectedPlayer(entity.name);
        setSelectedRoomNpc(null);
      } else if (entity.type === EntityType.NPC) {
        setSelectedRoomNpc((entity as NpcEntity).roomId);
        setSelectedPlayer(null);
      } else {
        setSelectedPlayer(null);
        setSelectedRoomNpc(null);
      }
    },
    [setSelectedPlayer, setSelectedRoomNpc],
  );

  const renderMap = (fullscreen: boolean) => (
    <Map
      config={config}
      mapDefinition={mapDef}
      height={fullscreen ? '100vh' : height}
      onConfigChange={setConfig}
      playing={playing}
      width={fullscreen ? '100vw' : width}
    >
      <MapCanvas
        entities={entities}
        selectedEntity={selectedEntity}
        onEntitySelected={onEntitySelected}
      >
        <ReplayClock currentTick={currentTick} onTick={advanceTick} />
      </MapCanvas>
      <MapControlsSection>
        <CustomButton
          icon={fullscreen ? 'fas fa-compress' : 'fas fa-maximize'}
          label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          onClick={() => setIsFullscreen((prev) => !prev)}
        />
        <CameraResetButton />
        <MapSettings />
      </MapControlsSection>
    </Map>
  );

  return (
    <>
      <Card
        header={{
          title: 'Room Replay',
          action: (
            <div className={styles.testingNotice}>
              <span className={styles.noticeText}>
                Previewing Blert&apos;s new replay system
              </span>
              <button
                className={styles.legacyButton}
                disabled={playing}
                onClick={setUseLegacy}
              >
                Switch to original
              </button>
            </div>
          ),
        }}
        className={styles.replay}
      >
        {!isFullscreen && renderMap(false)}
      </Card>

      <Modal
        open={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        className={styles.fullscreenModal}
      >
        {isFullscreen && renderMap(true)}
      </Modal>
    </>
  );
}
