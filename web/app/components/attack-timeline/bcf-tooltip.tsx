'use client';

import {
  BCFAttackAction,
  BCFCell,
  BCFNpcAttackAction,
  BCFResolver,
  BCFSpellAction,
} from '@blert/bcf';
import { NpcAttack, PlayerAttack, PlayerSpell } from '@blert/common';
import Image from 'next/image';
import React, { createContext, useContext } from 'react';

import Tooltip from '@/components/tooltip';

import {
  ATTACK_METADATA,
  NPC_ATTACK_METADATA,
  SPELL_METADATA,
} from './attack-metadata';
import {
  AttackInfo,
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
} from './tooltip-primitives';

type BcfTooltipContextType = {
  resolver: BCFResolver;
  onActorSelect?: (actorId: string) => void;
};

const BcfTooltipContext = createContext<BcfTooltipContextType | null>(null);

function getAttackVerb(attack: BCFAttackAction): string {
  const type = PlayerAttack[attack.attackType as keyof typeof PlayerAttack];
  return ATTACK_METADATA[type]?.verb ?? 'attacked';
}

function getSpellMeta(spell: BCFSpellAction): {
  name: string;
  imageUrl: string;
} {
  const type = PlayerSpell[spell.spellType as keyof typeof PlayerSpell];
  const meta = SPELL_METADATA[type];
  if (meta !== undefined) {
    return { name: meta.name, imageUrl: meta.imageUrl };
  }
  return {
    name: 'Unknown spell',
    imageUrl: SPELL_METADATA[PlayerSpell.UNKNOWN].imageUrl,
  };
}

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

type PlayerTooltipContentProps = {
  resolver: BCFResolver;
  actorId: string;
  tick: number;
  cell: BCFCell | undefined;
  onActorSelect?: (actorId: string) => void;
};

function PlayerTooltipContent({
  resolver,
  actorId,
  tick,
  cell,
  onActorSelect,
}: PlayerTooltipContentProps) {
  const actor = resolver.getActor(actorId);
  if (actor === undefined) {
    return null;
  }

  const state = resolver.getPlayerState(actorId, tick);
  const actions = cell?.actions ?? [];
  const attack = actions.find((a) => a.type === 'attack');
  const spell = actions.find((a) => a.type === 'spell');
  const diedThisTick = actions.some((a) => a.type === 'death');

  const sections: React.ReactNode[] = [];

  const headerName = onActorSelect ? (
    <PlayerChip name={actor.name} onClick={() => onActorSelect(actorId)} />
  ) : (
    actor.name
  );
  sections.push(
    <TooltipHeader key="header" name={headerName} tick={tick} showTime />,
  );

  if (attack !== undefined) {
    const verb = getAttackVerb(attack);
    let targetChip: React.ReactNode = null;

    if (attack.targetActorId !== undefined) {
      const targetActor = resolver.getActor(attack.targetActorId);
      if (targetActor !== undefined) {
        if (targetActor.type === 'npc') {
          targetChip = <NpcChip name={targetActor.name} />;
        } else {
          targetChip = (
            <PlayerChip
              name={targetActor.name}
              onClick={
                onActorSelect
                  ? () => onActorSelect(attack.targetActorId!)
                  : undefined
              }
            />
          );
        }
      }
    }

    sections.push(
      <React.Fragment key="attack">
        <TooltipDivider />
        <TooltipSection icon="fas fa-bolt" title="Attack">
          <AttackInfo
            verb={verb}
            target={targetChip}
            distance={attack.distanceToTarget}
          />
        </TooltipSection>
      </React.Fragment>,
    );
  }

  if (spell !== undefined) {
    const spellMeta = getSpellMeta(spell);
    let targetElement: React.ReactNode = null;

    if (spell.targetActorId !== undefined) {
      const targetActor = resolver.getActor(spell.targetActorId);
      if (targetActor !== undefined) {
        if (targetActor.type === 'npc') {
          targetElement = (
            <>
              on <NpcChip name={targetActor.name} />
            </>
          );
        } else {
          targetElement = (
            <>
              on{' '}
              <PlayerChip
                name={targetActor.name}
                onClick={
                  onActorSelect
                    ? () => onActorSelect(spell.targetActorId!)
                    : undefined
                }
              />
            </>
          );
        }
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

  if (state?.specEnergy !== undefined) {
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
            <span style={{ fontSize: '0.85rem' }}>{state.specEnergy}%</span>
          </div>
        </TooltipSection>
      </React.Fragment>,
    );
  }

  if (diedThisTick || state?.isDead) {
    sections.push(
      <React.Fragment key="death">
        <TooltipDivider />
        <TooltipSection icon="fas fa-skull" title="Death">
          <DeathInfo diedThisTick={diedThisTick} />
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

type NpcTooltipContentProps = {
  resolver: BCFResolver;
  actorId: string;
  tick: number;
  cell: BCFCell | undefined;
  onActorSelect?: (actorId: string) => void;
};

function NpcTooltipContent({
  resolver,
  actorId,
  tick,
  cell,
  onActorSelect,
}: NpcTooltipContentProps) {
  const actor = resolver.getActor(actorId);
  if (actor === undefined) {
    return null;
  }

  const actions = cell?.actions ?? [];
  const attack = actions.find((a) => a.type === 'npcAttack');

  const sections: React.ReactNode[] = [];

  sections.push(
    <TooltipHeader
      key="header"
      name={<NpcChip name={actor.name} />}
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
          targetChip = (
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

function BcfTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  const context = useContext(BcfTooltipContext);
  if (activeAnchor === null || context === null) {
    return null;
  }

  const { resolver, onActorSelect } = context;

  const tooltipType = activeAnchor.dataset.tooltipType;
  if (tooltipType !== 'actor') {
    return null;
  }

  const actorId = activeAnchor.dataset.tooltipActorId;
  const tick = parseInt(activeAnchor.dataset.tooltipTick ?? '0', 10);

  if (actorId === undefined) {
    return null;
  }

  const actor = resolver.getActor(actorId);
  if (actor === undefined) {
    return null;
  }

  const cell = resolver.getCell(actorId, tick);

  if (actor.type === 'npc') {
    return (
      <NpcTooltipContent
        resolver={resolver}
        actorId={actorId}
        tick={tick}
        cell={cell}
        onActorSelect={onActorSelect}
      />
    );
  }

  return (
    <PlayerTooltipContent
      resolver={resolver}
      actorId={actorId}
      tick={tick}
      cell={cell}
      onActorSelect={onActorSelect}
    />
  );
}

const BCF_TOOLTIP_ID = 'bcf-timeline-tooltip';

type BcfTooltipProps = {
  resolver: BCFResolver;
  onActorSelect?: (actorId: string) => void;
};

export function BcfTooltip({ resolver, onActorSelect }: BcfTooltipProps) {
  return (
    <BcfTooltipContext.Provider value={{ resolver, onActorSelect }}>
      <Tooltip
        clickable
        tooltipId={BCF_TOOLTIP_ID}
        render={BcfTooltipRenderer}
      />
    </BcfTooltipContext.Provider>
  );
}

export { BCF_TOOLTIP_ID };
