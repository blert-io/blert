import { Skill } from '@blert/common';

import Card from '@/components/card';
import Carousel from '@/components/carousel';
import EquipmentViewer from '@/components/equipment-viewer';
import KeyPrayers from '@/components/key-prayers';
import PlayerSkill from '@/components/player-skill';
import { useDisplay } from '@/display';
import { BoostType, maxBoostedLevel } from '@/utils/combat';
import { PlayerState } from '@/utils/boss-room-state';

import styles from './style.module.scss';

type BossPagePartyProps = {
  playerTickState: Record<string, PlayerState | null>;
  selectedPlayer: string | null;
  setSelectedPlayer: (player: string | null) => void;
};

export default function BossPageParty({
  playerTickState,
  selectedPlayer,
  setSelectedPlayer,
}: BossPagePartyProps) {
  const display = useDisplay();

  const toggleSelectedPlayer = (username: string) => {
    setSelectedPlayer(selectedPlayer === username ? null : username);
  };

  const combatThresholds = (boost: BoostType, level: number) => ({
    high: maxBoostedLevel(boost, level),
    low: level,
  });

  const party = Object.entries(playerTickState).map(([username, state]) => (
    <div
      role="button"
      className={`${styles.actor}${username === selectedPlayer ? ` ${styles.selected}` : ''}`}
      key={username}
      onClick={() => toggleSelectedPlayer(username)}
    >
      <h2>{username}</h2>
      <div className={styles.prayers}>
        <KeyPrayers
          prayerSet={state?.player.prayerSet || 0}
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
            className={styles.skill}
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
