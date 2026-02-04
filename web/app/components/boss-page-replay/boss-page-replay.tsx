'use client';

import { useCallback, useContext, useState } from 'react';

import Card from '@/components/card';
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

type BossReplayProps = {
  entities: AnyEntity[];
  preloads: string[];
  mapDef: MapDefinition;
  playing: boolean;
  width: number;
  height: number;
  currentTick: number;
  advanceTick: () => void;
  setUseLegacy?: () => void;
  /** Custom controls to render above the map. */
  customControls?: React.ReactNode;
};

export function BossPageReplay({
  entities,
  preloads,
  mapDef,
  playing,
  width,
  height,
  currentTick,
  advanceTick,
  customControls,
}: BossReplayProps) {
  const [config, setConfig] = useState({
    interpolationEnabled: true,
    tickDuration: 600,
    debug: false,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const selectedEntity =
    selectedActor?.type === 'player'
      ? entities.find(
          (entity) =>
            entity.type === EntityType.PLAYER &&
            entity.name === selectedActor.name,
        )
      : selectedActor?.type === 'npc'
        ? entities.find(
            (entity) =>
              entity.type === EntityType.NPC &&
              (entity as NpcEntity).roomId === selectedActor.roomId,
          )
        : null;

  const onEntitySelected = useCallback(
    (entity: AnyEntity | null) => {
      if (entity === null) {
        setSelectedActor(null);
        return;
      }

      if (entity.type === EntityType.PLAYER) {
        setSelectedActor({ type: 'player', name: entity.name });
      } else if (entity.type === EntityType.NPC) {
        setSelectedActor({ type: 'npc', roomId: (entity as NpcEntity).roomId });
      } else {
        setSelectedActor(null);
      }
    },
    [setSelectedActor],
  );

  const renderMap = (fullscreen: boolean) => (
    <Map
      config={config}
      mapDefinition={mapDef}
      height={height}
      isFullscreen={fullscreen}
      onConfigChange={setConfig}
      playing={playing}
      width={width}
    >
      <MapCanvas
        entities={entities}
        preloadTextures={preloads}
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
      <Card header={{ title: 'Room Replay' }} className={styles.replay}>
        {!isFullscreen && renderMap(false)}
        {customControls}
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
