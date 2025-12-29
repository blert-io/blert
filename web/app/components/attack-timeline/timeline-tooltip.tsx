'use client';

import {
  DataSource,
  NpcAttack,
  PlayerAttack,
  Skill,
  getNpcDefinition,
  npcFriendlyName,
} from '@blert/common';
import Image from 'next/image';
import React, { useContext } from 'react';

import { ActorContext } from '@/(challenges)/challenge-context-provider';
import {
  CustomPlayerState,
  PlayerState,
  PlayerStateMap,
  RoomNpcMap,
} from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';
import { ticksToFormattedSeconds } from '@/utils/tick';

import {
  ATTACK_METADATA,
  CombatStyle,
  NPC_ATTACK_METADATA,
} from './attack-metadata';
import PlayerSkill from '../player-skill';
import KeyPrayers from '../key-prayers';

import Tooltip from '@/components/tooltip';

import styles from './style.module.scss';

type TimelineDataContextType = {
  playerState: PlayerStateMap;
  npcs: RoomNpcMap;
};

const TimelineDataContext = React.createContext<TimelineDataContextType | null>(
  null,
);

function PlayerTooltipContent({ state }: { state: PlayerState }) {
  const { setSelectedPlayer } = useContext(ActorContext);
  const context = useContext(TimelineDataContext);

  const sections: React.ReactNode[] = [];

  const headerSection = (
    <div className={styles.tooltipHeader} key="header">
      <button
        className={styles.playerName}
        onClick={() => setSelectedPlayer(state.player.name)}
      >
        {state.player.name}
      </button>
      <span className={styles.tickInfo}>Tick {state.tick}</span>
      <span className={styles.timeInfo}>
        {ticksToFormattedSeconds(state.tick)}
      </span>
    </div>
  );
  sections.push(headerSection);

  const attack = state.attack;
  if (attack !== undefined) {
    const meta =
      ATTACK_METADATA[attack.type] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];

    let targetName: string | undefined;
    let hitpoints: string | undefined;

    if (attack.target !== undefined && context !== null) {
      const roomNpc = context.npcs.get(attack.target.roomId);
      if (roomNpc !== undefined) {
        targetName = npcFriendlyName(roomNpc, context.npcs);
        const hp = roomNpc.stateByTick[state.tick]?.hitpoints;
        if (hp !== undefined) {
          hitpoints = hp.percentage().toFixed(2);
        }
      }
    }

    const attackSection = (
      <div className={styles.tooltipSection} key="attack">
        <div className={styles.sectionHeader}>
          <i className="fas fa-bolt" />
          <span>Attack</span>
        </div>
        <div className={styles.attackInfo}>
          <span className={styles.attackVerb}>{meta.verb}</span>
          <button className={styles.npc}>
            {targetName}
            {hitpoints && (
              <span className={styles.hitpoints}>
                <i className="far fa-heart" />
                {hitpoints}%
              </span>
            )}
          </button>
          {meta.ranged && (
            <span className={styles.distanceInfo}>
              from {attack.distanceToTarget} tile
              {attack.distanceToTarget === 1 ? '' : 's'} away
            </span>
          )}
        </div>
      </div>
    );
    sections.push(attackSection);
  }

  if (state.player.source === DataSource.PRIMARY) {
    const combatThresholds = (boost: BoostType, level: number) => ({
      high: maxBoostedLevel(boost, level),
      low: level,
    });

    const stats = [];

    const attackType = state.attack?.type ?? null;
    const meta = attackType
      ? (ATTACK_METADATA[attackType] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN])
      : null;
    const emphasizedClass = (style: CombatStyle) =>
      meta?.style === style
        ? `${styles.combatStat} ${styles.emphasized}`
        : styles.combatStat;

    const attackSkill = state.skills[Skill.ATTACK];
    if (attackSkill !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.MELEE)}
          key="attack"
          skill={Skill.ATTACK}
          level={attackSkill}
          thresholds={combatThresholds(
            BoostType.SUPER_COMBAT,
            attackSkill.getBase(),
          )}
        />,
      );
    }

    const strengthSkill = state.skills[Skill.STRENGTH];
    if (strengthSkill !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.MELEE)}
          key="strength"
          skill={Skill.STRENGTH}
          level={strengthSkill}
          thresholds={combatThresholds(
            BoostType.SUPER_COMBAT,
            strengthSkill.getBase(),
          )}
        />,
      );
    }

    const rangedSkill = state.skills[Skill.RANGED];
    if (rangedSkill !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.RANGED)}
          key="ranged"
          skill={Skill.RANGED}
          level={rangedSkill}
          thresholds={combatThresholds(
            BoostType.RANGING_POTION,
            rangedSkill.getBase(),
          )}
        />,
      );
    }

    const magicSkill = state.skills[Skill.MAGIC];
    if (magicSkill !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.MAGIC)}
          key="magic"
          skill={Skill.MAGIC}
          level={magicSkill}
          thresholds={combatThresholds(
            BoostType.SATURATED_HEART,
            magicSkill.getBase(),
          )}
        />,
      );
    }

    if (stats.length > 0) {
      const statsSection = (
        <div className={styles.tooltipSection} key="stats">
          <div className={styles.sectionHeader}>
            <i className="fas fa-chart-bar" />
            <span>Combat Stats</span>
          </div>
          <div className={styles.statsGrid}>{stats}</div>
          <KeyPrayers
            combatOnly
            prayerSet={state.player.prayerSet}
            source={DataSource.PRIMARY}
          />
        </div>
      );
      sections.push(statsSection);
    }
  }

  if (state.diedThisTick || state.isDead) {
    const deathSection = (
      <div className={styles.tooltipSection} key="death">
        <div className={styles.sectionHeader}>
          <i className="fas fa-skull" />
          <span>Death</span>
        </div>
        <div className={styles.deathInfo}>
          {state.diedThisTick ? 'Player died this tick' : 'Player is dead'}
        </div>
      </div>
    );
    sections.push(deathSection);
  }

  if (state.customState.length > 0) {
    const customStateSection = (
      <div className={styles.tooltipSection} key="custom-state">
        <div className={styles.sectionHeader}>
          <i className="fas fa-info-circle" />
          <span>Other</span>
        </div>
        <div className={styles.customStateList}>
          {state.customState.map((cs: CustomPlayerState, i: number) => (
            <div key={i} className={styles.customStateItem}>
              <div className={styles.customStateIcon}>
                {cs.icon ? (
                  <Image
                    src={cs.icon}
                    alt={cs.label}
                    height={16}
                    width={16}
                    style={{ objectFit: 'contain' }}
                  />
                ) : (
                  <i className="fas fa-star" />
                )}
              </div>
              <span className={styles.customStateLabel}>
                {cs.fullText ?? cs.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
    sections.push(customStateSection);
  }

  if (sections.length === 1) {
    sections.push(
      <div
        className={`${styles.tooltipSection} ${styles.noContent}`}
        key="no-content"
      >
        Nothing interesting happened.
      </div>,
    );
  }

  return (
    <div className={styles.tooltip}>
      {sections.map((section, index) => (
        <React.Fragment key={index}>
          {section}
          {index < sections.length - 1 && (
            <div className={styles.sectionDivider} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function NpcTooltipContent({ roomId, tick }: { roomId: number; tick: number }) {
  const { setSelectedPlayer } = useContext(ActorContext);
  const context = useContext(TimelineDataContext);

  if (context === null) {
    return null;
  }

  const npc = context.npcs.get(roomId);
  if (npc === undefined) {
    return null;
  }

  const attack = npc.stateByTick[tick]?.attack;
  if (!attack) {
    return null;
  }

  const npcName = getNpcDefinition(npc.spawnNpcId)?.fullName ?? 'Unknown';
  const meta =
    NPC_ATTACK_METADATA[attack.type] ?? NPC_ATTACK_METADATA[NpcAttack.UNKNOWN];

  const npcButton = <button className={styles.npc}>{npcName}</button>;
  const target = attack.target ? (
    <button onClick={() => setSelectedPlayer(attack.target)}>
      {attack.target}
    </button>
  ) : null;

  return (
    <div className={styles.tooltip}>
      <div className={styles.npcTooltip}>
        {meta.description(npcButton, target)}
      </div>
    </div>
  );
}

function TimelineTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  const context = useContext(TimelineDataContext);

  if (activeAnchor === null || context === null) {
    return null;
  }

  const tooltipType = activeAnchor.dataset.tooltipType;
  const tick = parseInt(activeAnchor.dataset.tooltipTick ?? '0', 10);

  if (tooltipType === 'npc') {
    const roomId = parseInt(activeAnchor.dataset.tooltipRoomId ?? '0', 10);
    return <NpcTooltipContent roomId={roomId} tick={tick} />;
  }

  if (tooltipType === 'player') {
    const username = activeAnchor.dataset.tooltipUsername;
    if (username === undefined) {
      return null;
    }

    const playerTimeline = context.playerState.get(username);
    if (playerTimeline === undefined) {
      return null;
    }

    const state = playerTimeline[tick];
    if (!state) {
      return null;
    }

    return <PlayerTooltipContent state={state} />;
  }

  return null;
}

type TimelineTooltipProps = {
  id: string;
  playerState: PlayerStateMap;
  npcs: RoomNpcMap;
};

export function TimelineTooltip({
  id,
  playerState,
  npcs,
}: TimelineTooltipProps) {
  return (
    <TimelineDataContext.Provider value={{ playerState, npcs }}>
      <Tooltip clickable tooltipId={id} render={TimelineTooltipRenderer} />
    </TimelineDataContext.Provider>
  );
}
