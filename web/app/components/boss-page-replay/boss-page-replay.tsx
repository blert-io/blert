'use client';

import { Skill } from '@blert/common';
import { useContext } from 'react';

import CollapsiblePanel from '@/components/collapsible-panel';
import EquipmentViewer from '@/components/equipment-viewer';
import KeyPrayers from '@/components/key-prayers';
import Map, { Entity, EntityType, MapDefinition } from '@/components/map';
import PlayerSkill from '@/components/player-skill';
import { ActorContext } from '@/raids/tob/context';
import { PlayerState } from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';

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

  const combatThresholds = (boost: BoostType, level: number) => ({
    high: maxBoostedLevel(boost, level),
    low: level,
  });

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
              <KeyPrayers
                prayerSet={state?.player.prayerSet || 0}
                source={state?.player.source}
              />
              <EquipmentViewer
                username={username}
                equipment={state?.equipment ?? null}
                source={state?.player.source}
              />
              <div className={styles.skills}>
                {state?.skills[Skill.HITPOINTS] && (
                  <PlayerSkill
                    className={styles.skill}
                    skill={Skill.HITPOINTS}
                    level={state.skills[Skill.HITPOINTS]}
                    thresholds={{
                      high: Math.floor(
                        state.skills[Skill.HITPOINTS].getBase() * 0.8,
                      ),
                      low: Math.floor(
                        state.skills[Skill.HITPOINTS].getBase() * 0.4,
                      ),
                    }}
                  />
                )}
                {state?.skills[Skill.ATTACK] && (
                  <PlayerSkill
                    className={styles.skill}
                    skill={Skill.ATTACK}
                    level={state.skills[Skill.ATTACK]}
                    thresholds={combatThresholds(
                      BoostType.SUPER_COMBAT,
                      state.skills[Skill.ATTACK].getBase(),
                    )}
                  />
                )}
                {state?.skills[Skill.RANGED] && (
                  <PlayerSkill
                    className={styles.skill}
                    skill={Skill.RANGED}
                    level={state.skills[Skill.RANGED]}
                    thresholds={combatThresholds(
                      BoostType.RANGING_POTION,
                      state.skills[Skill.RANGED].getBase(),
                    )}
                  />
                )}
                {state?.skills[Skill.PRAYER] && (
                  <PlayerSkill
                    className={styles.skill}
                    skill={Skill.PRAYER}
                    level={state.skills[Skill.PRAYER]}
                  />
                )}
                {state?.skills[Skill.STRENGTH] && (
                  <PlayerSkill
                    className={styles.skill}
                    skill={Skill.STRENGTH}
                    level={state.skills[Skill.STRENGTH]}
                    thresholds={combatThresholds(
                      BoostType.SUPER_COMBAT,
                      state.skills[Skill.STRENGTH].getBase(),
                    )}
                  />
                )}
                {state?.skills[Skill.MAGIC] && (
                  <PlayerSkill
                    className={styles.skill}
                    skill={Skill.MAGIC}
                    level={state.skills[Skill.MAGIC]}
                    thresholds={combatThresholds(
                      BoostType.SATURATED_HEART,
                      state.skills[Skill.MAGIC].getBase(),
                    )}
                  />
                )}
                <div className={styles.skill} />
                {state?.skills[Skill.DEFENCE] && (
                  <PlayerSkill
                    className={styles.skill}
                    skill={Skill.DEFENCE}
                    level={state.skills[Skill.DEFENCE]}
                    thresholds={combatThresholds(
                      BoostType.SUPER_COMBAT,
                      state.skills[Skill.DEFENCE].getBase(),
                    )}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </CollapsiblePanel>
  );
}
