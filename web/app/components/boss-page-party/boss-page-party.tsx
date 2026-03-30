import { EquipmentSlot, Skill, SkillLevel } from '@blert/common';
import { memo } from 'react';

import { SelectedActor } from '@/(challenges)/challenge-context-provider';
import Card from '@/components/card';
import Carousel from '@/components/carousel';
import EquipmentViewer from '@/components/equipment-viewer';
import KeyPrayers from '@/components/key-prayers';
import PlayerSkill from '@/components/player-skill';
import { useDisplay } from '@/display';
import { PlayerEquipment, PlayerState } from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';

import styles from './style.module.scss';

type BossPagePartyProps = {
  playerTickState: Record<string, PlayerState | null>;
  selectedActor: SelectedActor | null;
  setSelectedActor: (actor: SelectedActor | null) => void;
};

const COMPARED_SKILLS = [
  Skill.HITPOINTS,
  Skill.ATTACK,
  Skill.RANGED,
  Skill.PRAYER,
  Skill.STRENGTH,
  Skill.MAGIC,
  Skill.DEFENCE,
] as const;

function equipmentEqual(
  a: PlayerEquipment | null,
  b: PlayerEquipment | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  for (const slot of Object.values(EquipmentSlot)) {
    const itemA = a[slot as EquipmentSlot];
    const itemB = b[slot as EquipmentSlot];
    if (itemA === itemB) {
      continue;
    }
    if (itemA === null || itemB === null) {
      return false;
    }
    if (itemA.id !== itemB.id || itemA.quantity !== itemB.quantity) {
      return false;
    }
  }
  return true;
}

function skillsEqual(
  a: Partial<Record<Skill, SkillLevel>>,
  b: Partial<Record<Skill, SkillLevel>>,
): boolean {
  for (const skill of COMPARED_SKILLS) {
    const levelA = a[skill];
    const levelB = b[skill];
    if (levelA === levelB) {
      continue;
    }
    if (levelA === undefined || levelB === undefined) {
      return false;
    }
    if (
      levelA.getCurrent() !== levelB.getCurrent() ||
      levelA.getBase() !== levelB.getBase()
    ) {
      return false;
    }
  }
  return true;
}

type PlayerPanelProps = {
  username: string;
  state: PlayerState | null;
  selected: boolean;
  onToggle: (username: string) => void;
};

const PlayerPanel = memo(
  function PlayerPanel({
    username,
    state,
    selected,
    onToggle,
  }: PlayerPanelProps) {
    const combatThresholds = (boost: BoostType, level: number) => ({
      high: maxBoostedLevel(boost, level),
      low: level,
    });

    return (
      <div
        role="button"
        className={`${styles.actor}${selected ? ` ${styles.selected}` : ''}`}
        onClick={() => onToggle(username)}
      >
        <h2>{username}</h2>
        <div className={styles.prayers}>
          <KeyPrayers
            prayerSet={state?.player.prayerSet ?? 0}
            source={state?.player.source}
          />
        </div>
        <div className={styles.equipment}>
          <EquipmentViewer
            username={username}
            equipment={state?.equipment ?? null}
            source={state?.player.source}
          />
        </div>
        <div className={styles.skills}>
          {state?.skills[Skill.HITPOINTS] && (
            <PlayerSkill
              skill={Skill.HITPOINTS}
              level={state.skills[Skill.HITPOINTS]}
              thresholds={{
                high: Math.floor(state.skills[Skill.HITPOINTS].getBase() * 0.8),
                low: Math.floor(state.skills[Skill.HITPOINTS].getBase() * 0.4),
              }}
            />
          )}
          {state?.skills[Skill.ATTACK] && (
            <PlayerSkill
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
              skill={Skill.PRAYER}
              level={state.skills[Skill.PRAYER]}
            />
          )}
          {state?.skills[Skill.STRENGTH] && (
            <PlayerSkill
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
              skill={Skill.MAGIC}
              level={state.skills[Skill.MAGIC]}
              thresholds={combatThresholds(
                BoostType.SATURATED_HEART,
                state.skills[Skill.MAGIC].getBase(),
              )}
            />
          )}
          {state?.skills[Skill.DEFENCE] && (
            <PlayerSkill
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
    );
  },
  (prev, next) => {
    if (prev.username !== next.username || prev.selected !== next.selected) {
      return false;
    }
    if (prev.state === next.state) {
      return true;
    }
    if (prev.state === null || next.state === null) {
      return false;
    }
    return (
      prev.state.player.prayerSet === next.state.player.prayerSet &&
      prev.state.player.source === next.state.player.source &&
      equipmentEqual(prev.state.equipment, next.state.equipment) &&
      skillsEqual(prev.state.skills, next.state.skills)
    );
  },
);

export default function BossPageParty({
  playerTickState,
  selectedActor,
  setSelectedActor,
}: BossPagePartyProps) {
  const display = useDisplay();

  const isSelectedPlayer = (username: string) =>
    selectedActor?.type === 'player' && selectedActor.name === username;

  const toggleSelectedPlayer = (username: string) => {
    setSelectedActor(
      isSelectedPlayer(username) ? null : { type: 'player', name: username },
    );
  };

  const party = Object.entries(playerTickState).map(([username, state]) => (
    <PlayerPanel
      key={username}
      username={username}
      state={state}
      selected={isSelectedPlayer(username)}
      onToggle={toggleSelectedPlayer}
    />
  ));

  return (
    <Card className={styles.bossPageParty} header={{ title: 'Party' }}>
      {display.isCompact() && party.length > 1 ? (
        <Carousel itemWidth={236}>{party}</Carousel>
      ) : (
        <div className={styles.actors}>{party}</div>
      )}
    </Card>
  );
}
