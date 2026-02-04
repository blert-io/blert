'use client';

import { BCFNpcAttackAction, BCFResolver, BlertChartFormat } from '@blert/bcf';
import {
  DataSource,
  NpcAttack,
  npcFriendlyName,
  PlayerAttack,
  PlayerSpell,
  Skill,
  SpellTarget,
} from '@blert/common';
import Image from 'next/image';
import React, { createContext, useContext, useMemo } from 'react';

import {
  ATTACK_METADATA,
  CombatStyle,
  NPC_ATTACK_METADATA,
  SPELL_METADATA,
} from '@/components/attack-timeline/attack-metadata';
import {
  AttackInfo,
  CustomStateItem,
  CustomStateList,
  DeathInfo,
  NpcChip,
  PlayerChip,
  SpellChip,
  SpellInfo,
  TooltipContainer,
  TooltipDivider,
  TooltipHeader,
  TooltipNoContent,
  TooltipSection,
} from '@/components/attack-timeline/tooltip-primitives';
import {
  CustomRow,
  CustomState,
  StateProvider,
} from '@/components/attack-timeline/bcf-renderer';
import KeyPrayers from '@/components/key-prayers';
import PlayerSkill from '@/components/player-skill';
import Tooltip from '@/components/tooltip';
import {
  EnhancedRoomNpc,
  NpcActorId,
  PlayerStateMap,
  RoomNpcMap,
  extractNpcRoomId,
  isNpcActorId,
  toBcfNormalizedPlayerName,
  toNpcActorId,
} from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';
import { npcImageUrl } from '@/utils/url';

import styles from './styles.module.scss';

export const BOSS_PAGE_TOOLTIP_ID = 'boss-page-timeline-tooltip';

type TooltipContextType = {
  resolver: BCFResolver;
  playerState: PlayerStateMap;
  npcs: RoomNpcMap;
  normalizedParty: Map<string, string>;
  customRows: Map<string, CustomRow>;
  stateProvider?: StateProvider;
  onActorSelect?: (actorId: string) => void;
};

const TooltipContext = createContext<TooltipContextType | null>(null);

function getNpcAttackDescription(
  attack: BCFNpcAttackAction,
  targetChip: React.ReactNode,
): React.ReactNode {
  const type = NpcAttack[attack.attackType as keyof typeof NpcAttack];
  const meta = NPC_ATTACK_METADATA[type];
  if (meta !== undefined) {
    return meta.description(targetChip);
  }
  return (
    <>
      Unknown attack
      {targetChip && <> on {targetChip}</>}
    </>
  );
}

function RoomNpcChip({
  npc,
  tick,
  npcs,
  onActorSelect,
}: {
  npc: EnhancedRoomNpc;
  tick: number;
  npcs: RoomNpcMap;
  onActorSelect?: (actorId: string) => void;
}) {
  const imageId = npc.stateByTick[tick]?.id ?? npc.spawnNpcId;

  return (
    <NpcChip
      name={npcFriendlyName(npc, npcs)}
      imageUrl={npcImageUrl(imageId)}
      hitpoints={npc.stateByTick[tick]?.hitpoints?.percentage().toFixed(2)}
      onClick={
        onActorSelect
          ? () => onActorSelect(toNpcActorId(npc.roomId))
          : undefined
      }
    />
  );
}

function PlayerTooltipContent({
  actorId,
  tick,
}: {
  actorId: string;
  tick: number;
}) {
  const ctx = useContext(TooltipContext);
  if (ctx === null) {
    return null;
  }

  const { resolver, playerState, npcs, normalizedParty, onActorSelect } = ctx;
  const username = normalizedParty.get(actorId);
  if (username === undefined) {
    return null;
  }

  const state = playerState.get(username)?.[tick];
  if (!state) {
    return null;
  }

  const sections: React.ReactNode[] = [];

  const headerName = onActorSelect ? (
    <PlayerChip name={username} onClick={() => onActorSelect(actorId)} />
  ) : (
    username
  );
  sections.push(
    <TooltipHeader key="header" name={headerName} tick={tick} showTime />,
  );

  if (state.attack !== undefined) {
    const meta =
      ATTACK_METADATA[state.attack.type] ??
      ATTACK_METADATA[PlayerAttack.UNKNOWN];

    let targetChip: React.ReactNode = null;

    if (state.attack.target !== undefined) {
      const targetNpc = npcs.get(state.attack.target.roomId);
      if (targetNpc !== undefined) {
        targetChip = (
          <RoomNpcChip
            npc={targetNpc}
            tick={tick}
            npcs={npcs}
            onActorSelect={onActorSelect}
          />
        );
      }
    }

    sections.push(
      <React.Fragment key="attack">
        <TooltipDivider />
        <TooltipSection icon="fas fa-bolt" title="Attack">
          <AttackInfo
            verb={meta.verb}
            target={targetChip}
            distance={state.attack.distanceToTarget}
          />
        </TooltipSection>
      </React.Fragment>,
    );
  }

  if (state.spell !== undefined) {
    const spellMeta =
      SPELL_METADATA[state.spell.type] ?? SPELL_METADATA[PlayerSpell.UNKNOWN];
    let targetElement: React.ReactNode = null;

    if (state.spell.target !== undefined) {
      if (state.spell.target.type === SpellTarget.NPC) {
        const targetNpc = npcs.get(state.spell.target.npc.roomId);
        if (targetNpc !== undefined) {
          targetElement = (
            <>
              on{' '}
              <RoomNpcChip
                npc={targetNpc}
                tick={tick}
                npcs={npcs}
                onActorSelect={onActorSelect}
              />
            </>
          );
        }
      } else if (state.spell.target.type === SpellTarget.PLAYER) {
        const targetPlayer = state.spell.target.player;
        targetElement = (
          <>
            on{' '}
            <PlayerChip
              name={targetPlayer}
              onClick={
                onActorSelect
                  ? () => onActorSelect(toBcfNormalizedPlayerName(targetPlayer))
                  : undefined
              }
            />
          </>
        );
      }
    }

    sections.push(
      <React.Fragment key="spell">
        <TooltipDivider />
        <TooltipSection icon="fas fa-magic" title="Spell">
          <SpellInfo>
            <span>Cast</span>
            <SpellChip name={spellMeta.name} imageUrl={spellMeta.imageUrl} />
            {targetElement}
          </SpellInfo>
        </TooltipSection>
      </React.Fragment>,
    );
  }

  const bcfState = resolver.getPlayerState(actorId, tick);
  if (bcfState?.specEnergy !== undefined) {
    sections.push(
      <React.Fragment key="spec">
        <TooltipDivider />
        <TooltipSection icon="fas fa-star" title="Spec">
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <Image
              src="/images/combat/spec.png"
              alt="Spec"
              height={20}
              width={20}
            />
            <span style={{ fontSize: '0.85rem' }}>{bcfState.specEnergy}%</span>
          </div>
        </TooltipSection>
      </React.Fragment>,
    );
  }

  if (state.player.source === DataSource.PRIMARY) {
    const combatThresholds = (boost: BoostType, level: number) => ({
      high: maxBoostedLevel(boost, level),
      low: level,
    });

    const attackType = state.attack?.type ?? null;
    const meta =
      attackType !== null
        ? (ATTACK_METADATA[attackType] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN])
        : null;
    const emphasizedClass = (style: CombatStyle) =>
      meta?.style === style ? styles.emphasizedStat : styles.combatStat;

    const stats: React.ReactNode[] = [];

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
      sections.push(
        <React.Fragment key="stats">
          <TooltipDivider />
          <TooltipSection icon="fas fa-chart-bar" title="Combat Stats">
            <div className={styles.statsGrid}>{stats}</div>
            <KeyPrayers
              combatOnly
              prayerSet={state.player.prayerSet}
              source={DataSource.PRIMARY}
            />
          </TooltipSection>
        </React.Fragment>,
      );
    }
  }

  if (state.diedThisTick || state.isDead) {
    sections.push(
      <React.Fragment key="death">
        <TooltipDivider />
        <TooltipSection icon="fas fa-skull" title="Death">
          <DeathInfo diedThisTick={state.diedThisTick} />
        </TooltipSection>
      </React.Fragment>,
    );
  }

  const customStates: CustomState[] =
    ctx.stateProvider?.(tick, actorId) ??
    state.customState.map((cs) => ({
      label: cs.label,
      fullText: cs.fullText,
      iconUrl: cs.icon,
    })) ??
    [];

  if (customStates.length > 0) {
    sections.push(
      <React.Fragment key="custom-state">
        <TooltipDivider />
        <TooltipSection icon="fas fa-info-circle" title="Other">
          <CustomStateList>
            {customStates.map((cs, i) => (
              <CustomStateItem
                key={i}
                label={cs.fullText ?? cs.label ?? ''}
                iconUrl={cs.iconUrl}
              />
            ))}
          </CustomStateList>
        </TooltipSection>
      </React.Fragment>,
    );
  }

  // Fallback.
  if (sections.length === 1) {
    sections.push(
      <React.Fragment key="no-content">
        <TooltipDivider />
        <TooltipNoContent />
      </React.Fragment>,
    );
  }

  return <TooltipContainer>{sections}</TooltipContainer>;
}

function NpcTooltipContent({
  actorId,
  tick,
}: {
  actorId: NpcActorId;
  tick: number;
}) {
  const ctx = useContext(TooltipContext);
  if (ctx === null) {
    return null;
  }

  const { resolver, npcs, onActorSelect } = ctx;

  const npc = npcs.get(extractNpcRoomId(actorId));
  if (npc === undefined) {
    return null;
  }

  const cell = resolver.getCell(actorId, tick);
  const actions = cell?.actions ?? [];
  const attack = actions.find((a) => a.type === 'npcAttack');

  const sections: React.ReactNode[] = [];

  sections.push(
    <TooltipHeader
      key="header"
      name={
        <RoomNpcChip
          npc={npc}
          tick={tick}
          npcs={npcs}
          onActorSelect={onActorSelect}
        />
      }
      tick={tick}
      showTime
    />,
  );

  if (attack !== undefined) {
    let targetChip: React.ReactNode = null;
    const targetActorId = attack.targetActorId;

    if (targetActorId !== undefined) {
      const targetActor = resolver.getActor(targetActorId);
      if (targetActor !== undefined) {
        if (targetActor.type === 'npc') {
          const roomId = isNpcActorId(targetActorId)
            ? extractNpcRoomId(targetActorId)
            : null;
          const targetNpc = roomId !== null ? npcs.get(roomId) : undefined;
          targetChip =
            targetNpc !== undefined ? (
              <RoomNpcChip
                npc={targetNpc}
                tick={tick}
                npcs={npcs}
                onActorSelect={onActorSelect}
              />
            ) : (
              <NpcChip
                name={targetActor.name}
                onClick={
                  onActorSelect ? () => onActorSelect(targetActorId) : undefined
                }
              />
            );
        } else {
          targetChip = (
            <PlayerChip
              name={targetActor.name}
              onClick={
                onActorSelect ? () => onActorSelect(targetActorId) : undefined
              }
            />
          );
        }
      }
    }

    const description = getNpcAttackDescription(attack, targetChip);
    sections.push(
      <React.Fragment key="attack">
        <TooltipDivider />
        <TooltipSection icon="fas fa-bolt" title="Attack">
          <AttackInfo>{description}</AttackInfo>
        </TooltipSection>
      </React.Fragment>,
    );
  }

  const npcCustomStates = ctx.stateProvider?.(tick, actorId) ?? [];
  if (npcCustomStates.length > 0) {
    sections.push(
      <React.Fragment key="custom-state">
        <TooltipDivider />
        <TooltipSection icon="fas fa-info-circle" title="Other">
          <CustomStateList>
            {npcCustomStates.map((cs, i) => (
              <CustomStateItem
                key={i}
                label={cs.fullText ?? cs.label ?? ''}
                iconUrl={cs.iconUrl}
              />
            ))}
          </CustomStateList>
        </TooltipSection>
      </React.Fragment>,
    );
  }

  if (sections.length === 1) {
    sections.push(
      <React.Fragment key="no-content">
        <TooltipDivider />
        <TooltipNoContent />
      </React.Fragment>,
    );
  }

  return <TooltipContainer>{sections}</TooltipContainer>;
}

function CustomTooltipContent({
  rowId,
  tick,
}: {
  rowId: string;
  tick: number;
}) {
  const ctx = useContext(TooltipContext);
  if (ctx === null) {
    return null;
  }

  const customRow = ctx.customRows.get(rowId);
  if (customRow?.tooltipRenderer === undefined) {
    return null;
  }

  const body = customRow.tooltipRenderer(tick);
  if (body === null) {
    return null;
  }

  return (
    <TooltipContainer>
      <TooltipHeader name={customRow.name} tick={tick} showTime />
      <TooltipDivider />
      {body}
    </TooltipContainer>
  );
}

function TooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  const ctx = useContext(TooltipContext);
  if (activeAnchor === null || ctx === null) {
    return null;
  }

  const tooltipType = activeAnchor.dataset.tooltipType;
  const tick = parseInt(activeAnchor.dataset.tooltipTick ?? '0', 10);

  let content: React.ReactNode = null;

  if (tooltipType === 'actor') {
    const actorId = activeAnchor.dataset.tooltipActorId;
    if (actorId === undefined) {
      return null;
    }

    const actor = ctx.resolver.getActor(actorId);
    if (actor === undefined) {
      return null;
    }

    content =
      actor.type === 'npc' ? (
        <NpcTooltipContent actorId={actorId as NpcActorId} tick={tick} />
      ) : (
        <PlayerTooltipContent actorId={actorId} tick={tick} />
      );
  } else if (tooltipType === 'custom') {
    const rowId = activeAnchor.dataset.tooltipRowId;
    if (rowId === undefined) {
      return null;
    }
    content = <CustomTooltipContent rowId={rowId} tick={tick} />;
  }

  if (content === null) {
    return null;
  }

  return <div className={styles.tooltip}>{content}</div>;
}

type BossPageTooltipProps = {
  bcf: BlertChartFormat;
  playerState: PlayerStateMap;
  npcs: RoomNpcMap;
  normalizedParty: Map<string, string>;
  customRows?: CustomRow[];
  stateProvider?: StateProvider;
  onActorSelect?: (actorId: string) => void;
};

export function BossPageTooltip({
  bcf,
  playerState,
  npcs,
  normalizedParty,
  customRows: customRowsProp,
  stateProvider,
  onActorSelect,
}: BossPageTooltipProps) {
  const resolver = useMemo(() => new BCFResolver(bcf), [bcf]);

  const customRows = useMemo(() => {
    const map = new Map<string, CustomRow>();
    customRowsProp?.forEach((row, i) => map.set(`custom:${i}`, row));
    return map;
  }, [customRowsProp]);

  const contextValue = useMemo(
    () => ({
      resolver,
      playerState,
      npcs,
      normalizedParty,
      customRows,
      stateProvider,
      onActorSelect,
    }),
    [
      resolver,
      playerState,
      npcs,
      normalizedParty,
      customRows,
      stateProvider,
      onActorSelect,
    ],
  );

  return (
    <TooltipContext.Provider value={contextValue}>
      <Tooltip tooltipId={BOSS_PAGE_TOOLTIP_ID} render={TooltipRenderer} />
    </TooltipContext.Provider>
  );
}
