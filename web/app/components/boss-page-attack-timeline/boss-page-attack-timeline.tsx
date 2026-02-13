'use client';

import {
  BCFAction,
  BCFAttackAction,
  BCFPlayerAction,
  BlertChartFormat,
} from '@blert/bcf';
import { Npc, PlayerAttack, Skill, SkillLevel } from '@blert/common';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ActorContext } from '@/(challenges)/challenge-context-provider';
import { MemeContext } from '@/(challenges)/raids/meme-context';
import {
  AttackTimelineProps,
  bcfToPlayerAttack,
  CombatStyle,
  getAttackStyle,
} from '@/components/attack-timeline';
import {
  ActionEvaluation,
  ActionOutline,
  BcfRenderer,
  BcfRendererProps,
  CustomState,
  StateProvider,
} from '@/components/attack-timeline/bcf-renderer';
import Card from '@/components/card';
import Checkbox from '@/components/checkbox';
import Menu from '@/components/menu';
import Modal from '@/components/modal';
import { DisplayContext } from '@/display';
import {
  PlayerState,
  RoomNpcMap,
  transformBcf,
  toBcfNormalizedPlayerName,
  toNpcActorId,
  isNpcActorId,
  extractNpcRoomId,
} from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';
import { normalizeItemId } from '@/utils/item';
import { useSetting } from '@/utils/user-settings';

import { BossPageTooltip, BOSS_PAGE_TOOLTIP_ID } from './boss-page-tooltip';

import styles from './styles.module.scss';

function boostOutline(
  attackType: PlayerAttack,
  playerState: PlayerState,
): ActionOutline {
  const attackStyle = getAttackStyle(attackType);
  if (attackStyle === null) {
    return 'neutral';
  }

  let combatSkill: SkillLevel | undefined;
  let boostType: BoostType;

  switch (attackStyle) {
    case CombatStyle.MELEE:
      combatSkill = playerState.skills[Skill.STRENGTH];
      boostType = BoostType.SUPER_COMBAT;
      break;
    case CombatStyle.RANGED:
      combatSkill = playerState.skills[Skill.RANGED];
      boostType = BoostType.RANGING_POTION;
      break;
    case CombatStyle.MAGIC:
      combatSkill = playerState.skills[Skill.MAGIC];
      boostType = BoostType.SATURATED_HEART;
      break;
  }

  if (combatSkill === undefined) {
    return 'neutral';
  }

  const current = combatSkill.getCurrent();

  if (current === maxBoostedLevel(boostType, combatSkill.getBase())) {
    return 'success';
  }
  if (current > combatSkill.getBase()) {
    return 'warning';
  }
  return 'danger';
}

function isBlunder(
  attackType: PlayerAttack,
  action: BCFAttackAction,
  npcs: RoomNpcMap,
): boolean {
  switch (attackType) {
    case PlayerAttack.KODAI_BASH:
    case PlayerAttack.NM_STAFF_BASH:
    case PlayerAttack.SCYTHE_UNCHARGED:
    case PlayerAttack.TONALZTICS_UNCHARGED:
      return true;
  }

  // Other attacks are judged based on their target.
  if (action.targetActorId === undefined) {
    return false;
  }

  const roomId = isNpcActorId(action.targetActorId)
    ? extractNpcRoomId(action.targetActorId)
    : null;
  if (roomId === null) {
    return false;
  }

  const npc = npcs.get(roomId);
  if (npc === undefined) {
    return false;
  }

  const npcId = npc.spawnNpcId;

  switch (attackType) {
    case PlayerAttack.GODSWORD_SMACK:
    case PlayerAttack.HAMMER_BOP:
    case PlayerAttack.ELDER_MAUL:
      // Last hits, tick fills, and max hit autos in Colo.
      return (
        !Npc.isNylocas(npcId) &&
        !Npc.isVerzikMatomenos(npcId) &&
        !Npc.isFremennikArcher(npcId)
      );

    case PlayerAttack.CHALLY_SWIPE:
    case PlayerAttack.TONALZTICS_AUTO:
      // Tick fills on red crabs.
      return !Npc.isVerzikMatomenos(npcId);
  }

  return false;
}

export type CustomStateEntry = {
  playerName?: string;
  npcRoomId?: number;
  tick: number;
  states: CustomState[];
};

type BossPageAttackTimelineProps = AttackTimelineProps & {
  bcf: BlertChartFormat;
  customStates?: CustomStateEntry[];
};

export function BossPageAttackTimeline(props: BossPageAttackTimelineProps) {
  const display = useContext(DisplayContext);
  const memes = useContext(MemeContext);
  const { selectedActor, setSelectedActor } = useContext(ActorContext);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMenuPosition, setSettingsMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [cardWidth, setCardWidth] = useState(0);

  const [showKits, setShowKits] = useSetting<boolean>({
    key: 'timeline-show-kits',
    defaultValue: true,
  });
  const [showSpells, setShowSpells] = useSetting<boolean>({
    key: 'timeline-show-spells',
    defaultValue: true,
  });
  const [expanded, setExpanded] = useSetting<boolean>({
    key: 'timeline-expanded',
    defaultValue: false,
  });

  useEffect(() => {
    if (cardRef.current === null) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCardWidth(entry.contentRect.width - 10);
      }
    });

    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  const menuItems = useMemo(
    () => [
      {
        label: 'timeline-show-spells',
        customAction: () => false,
        customElement: (
          <Checkbox
            className={styles.settingsCheckbox}
            label="Show spell icons"
            checked={showSpells}
            onChange={(checked) => setShowSpells(checked)}
            simple
          />
        ),
      },
      {
        label: 'timeline-show-kits',
        customAction: () => false,
        customElement: (
          <Checkbox
            className={styles.settingsCheckbox}
            label="Show kitted weapons"
            checked={showKits}
            onChange={(checked) => setShowKits(checked)}
            simple
          />
        ),
      },
      {
        label: 'timeline-expanded',
        customAction: () => false,
        customElement: (
          <Checkbox
            className={styles.settingsCheckbox}
            label="Show expanded timeline"
            checked={expanded}
            onChange={(checked) => setExpanded(checked)}
            simple
          />
        ),
      },
    ],
    [showSpells, showKits, expanded, setShowSpells, setShowKits, setExpanded],
  );

  let cellSize = props.cellSize;
  if (display.isCompact()) {
    cellSize = 24;
  }

  // Calculate modal width when modal is open.
  const modalWidth = showFullTimeline
    ? Math.floor(window.innerWidth * 0.98)
    : 0;

  // Calculate inline wrapWidth when expanded mode is enabled.
  const inlineWrapWidth = expanded && cardWidth > 0 ? cardWidth : undefined;

  const settingsMenuWidth = 240;

  const openSettings = () => {
    if (settingsButtonRef.current) {
      const rect = settingsButtonRef.current.getBoundingClientRect();
      setSettingsMenuPosition({
        x: rect.x + rect.width - settingsMenuWidth,
        y: rect.y + rect.height + 4,
      });
    }
    setShowSettings(true);
  };

  const transformAction = useMemo(() => {
    return (action: BCFAction): BCFAction | null => {
      if (!showSpells && action.type === 'spell') {
        return null;
      }
      if (
        !showKits &&
        action.type === 'attack' &&
        action.weaponId !== undefined
      ) {
        return { ...action, weaponId: normalizeItemId(action.weaponId) };
      }
      return action;
    };
  }, [showSpells, showKits]);

  const bcf = useMemo(
    () => transformBcf(props.bcf, transformAction),
    [props.bcf, transformAction],
  );
  const normalizedParty = useMemo(() => {
    return new Map(
      Array.from(props.playerState.keys()).map((name) => [
        toBcfNormalizedPlayerName(name),
        name,
      ]),
    );
  }, [props.playerState]);

  const selectedActorId = useMemo(() => {
    if (selectedActor === null) {
      return undefined;
    }
    if (selectedActor.type === 'player') {
      return toBcfNormalizedPlayerName(selectedActor.name);
    }
    return toNpcActorId(selectedActor.roomId);
  }, [selectedActor]);

  const onActorSelect = useCallback(
    (actorId: string) => {
      if (actorId === selectedActorId) {
        setSelectedActor(null);
        return;
      }

      const roomId = isNpcActorId(actorId) ? extractNpcRoomId(actorId) : null;
      if (roomId !== null) {
        setSelectedActor({ type: 'npc', roomId });
      } else {
        const displayName = normalizedParty.get(actorId);
        if (displayName !== undefined) {
          setSelectedActor({ type: 'player', name: displayName });
        }
      }
    },
    [selectedActorId, normalizedParty, setSelectedActor],
  );

  const actionEvaluator = useMemo(() => {
    return (
      tick: number,
      actorId: string,
      action: BCFPlayerAction,
    ): ActionEvaluation | null => {
      if (action.type !== 'attack') {
        return null;
      }

      const actorName = normalizedParty.get(actorId);
      if (actorName === undefined) {
        return null;
      }

      const playerState = props.playerState.get(actorName)?.[tick];
      if (!playerState) {
        return null;
      }

      const attackType = bcfToPlayerAttack(action.attackType);
      if (attackType === null) {
        return { outline: 'neutral', blunder: false };
      }

      return {
        outline: boostOutline(attackType, playerState),
        blunder: isBlunder(attackType, action, props.npcs),
      };
    };
  }, [props.playerState, props.npcs, normalizedParty]);

  const stateProvider: StateProvider | undefined = useMemo(() => {
    if (props.customStates === undefined) {
      return undefined;
    }

    const lookup = new Map<string, Map<number, CustomState[]>>();
    for (const entry of props.customStates) {
      let actorId: string;
      if (entry.playerName !== undefined) {
        actorId = toBcfNormalizedPlayerName(entry.playerName);
      } else if (entry.npcRoomId !== undefined) {
        actorId = toNpcActorId(entry.npcRoomId);
      } else {
        continue;
      }

      let tickMap = lookup.get(actorId);
      if (tickMap === undefined) {
        tickMap = new Map();
        lookup.set(actorId, tickMap);
      }

      const existing = tickMap.get(entry.tick);
      if (existing !== undefined) {
        existing.push(...entry.states);
      } else {
        tickMap.set(entry.tick, [...entry.states]);
      }
    }

    return (tick: number, actorId: string) => {
      return lookup.get(actorId)?.get(tick) ?? null;
    };
  }, [props.customStates]);

  const compactTimelineProps: Partial<BcfRendererProps> = {};
  if (display.isCompact()) {
    compactTimelineProps.smallLegend = true;
    compactTimelineProps.scrollMinColumns = 8;
    compactTimelineProps.scrollVisibleColumns = 4;
  }

  const sharedRendererProps = {
    bcf,
    selectedActorId,
    onActorSelect,
    actionEvaluator,
    stateProvider,
    letterMode: memes.capsLock,
    showInventoryTags: memes.inventoryTags,
    tooltipId: BOSS_PAGE_TOOLTIP_ID,
    customRows: props.customRows,
    currentTick: props.currentTick,
    onTickSelect: props.updateTickOnPage,
  };

  let fullTimeline = null;
  if (showFullTimeline) {
    const paddingY = display.isCompact() ? 20 : 10;
    const paddingX = display.isCompact() ? 12 : 30;
    const timelineWidth = modalWidth - 2 * paddingX;

    fullTimeline = (
      <div
        className={styles.timelineModal}
        style={{ padding: `${paddingY}px ${paddingX}px` }}
      >
        <BcfRenderer
          cellSize={display.isFull() ? 28 : 22}
          wrapWidth={timelineWidth}
          {...sharedRendererProps}
        />
      </div>
    );
  }

  return (
    <>
      <Card
        className={styles.attackTimelineCard}
        fixed
        header={{
          title: 'BCF Renderer',
          action: (
            <div className={styles.actionButtons}>
              <button onClick={() => setShowFullTimeline(true)}>
                <i className="fas fa-expand" />
                <span>Full Screen</span>
              </button>
              <button
                ref={settingsButtonRef}
                id="timeline-settings-button"
                onClick={openSettings}
              >
                <i className="fas fa-cog" />
                <span>Settings</span>
              </button>
            </div>
          ),
          styles: { marginBottom: 0 },
        }}
      >
        <div ref={cardRef}>
          <BcfRenderer
            cellSize={cellSize ?? 30}
            wrapWidth={inlineWrapWidth}
            {...sharedRendererProps}
            {...compactTimelineProps}
          />
        </div>
      </Card>
      <Modal
        className={styles.fullScreenModal}
        header="Room Timeline"
        open={showFullTimeline}
        onClose={() => setShowFullTimeline(false)}
        width={modalWidth}
      >
        {fullTimeline}
      </Modal>
      <Menu
        open={showSettings}
        onClose={() => setShowSettings(false)}
        position={settingsMenuPosition}
        items={menuItems}
        width={settingsMenuWidth}
      />
      <BossPageTooltip
        bcf={bcf}
        playerState={props.playerState}
        npcs={props.npcs}
        normalizedParty={normalizedParty}
        customRows={props.customRows}
        stateProvider={stateProvider}
        onActorSelect={onActorSelect}
      />
    </>
  );
}
