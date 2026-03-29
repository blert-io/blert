import { Challenge, Stage } from '@blert/common';
import { useRef } from 'react';

import { useLiveChallenge } from '@/challenge-context';

import {
  EventMapBuilder,
  EventTickMap,
  EventTypeMap,
  NpcMapBuilder,
  NpcStateBuilder,
  PlayerStateBuilder,
  PlayerStateMap,
  RoomNpcMap,
  StageState,
  toBcf,
} from './stage-state';

type IncrementalState = {
  events: EventMapBuilder;
  npcMap: NpcMapBuilder;
  players: PlayerStateBuilder;
  npcs: NpcStateBuilder;
  processedEventCount: number;

  // Reference-stable snapshots of state builder output.
  eventsByTick: EventTickMap;
  eventsByType: EventTypeMap;
  playerState: PlayerStateMap;
  npcState: RoomNpcMap;
};

function createIncrementalState(): IncrementalState {
  return {
    events: new EventMapBuilder(),
    npcMap: new NpcMapBuilder(),
    players: new PlayerStateBuilder(),
    npcs: new NpcStateBuilder(),
    processedEventCount: 0,
    eventsByTick: {},
    eventsByType: {},
    playerState: new Map(),
    npcState: new Map(),
  };
}

const EMPTY_BCF = {
  version: '1.0' as const,
  name: '',
  description: '',
  config: { totalTicks: 0, rowOrder: [] as string[], startTick: 0 },
  timeline: { actors: [] as never[], ticks: [] as never[] },
};

export function useLiveStageState<T extends Challenge>(
  challenge: T | null,
  hasStaticData: boolean,
  stage: Stage,
  attempt?: number,
): StageState<T> | null {
  const live = useLiveChallenge();
  const ref = useRef<IncrementalState | null>(null);

  const liveAttempt = live.currentStage?.attempt ?? undefined;
  const isLiveStage =
    !hasStaticData &&
    live.isLive &&
    live.currentStage?.stage === stage &&
    liveAttempt === attempt;

  // Reset state when exiting live or the provider reset.
  if (
    !isLiveStage ||
    challenge === null ||
    (ref.current !== null &&
      live.liveEvents.length < ref.current.processedEventCount)
  ) {
    ref.current = null;
  }

  if (!isLiveStage || challenge === null) {
    return null;
  }

  // Show loading state during live replay.
  if (live.replaying) {
    return {
      challenge,
      events: [],
      totalTicks: 0,
      loading: true,
      isLive: true,
      isStreaming: live.isStreaming,
      eventsByTick: {},
      eventsByType: {},
      playerState: new Map(),
      npcState: new Map(),
      bcf: EMPTY_BCF,
    } as StageState<T>;
  }

  const totalTicks = live.lastTick === null ? 0 : live.lastTick + 1;

  ref.current ??= createIncrementalState();
  const state = ref.current;

  const newEvents = live.liveEvents.slice(state.processedEventCount);
  if (newEvents.length > 0) {
    state.events.append(newEvents);
    state.npcMap.append(newEvents);

    const party = challenge.party.map((p) => p.username);
    state.players.extend(
      party,
      totalTicks,
      state.events.eventsByTick,
      state.events.eventsByType,
    );
    state.npcs.extend(
      state.npcMap.npcMap,
      totalTicks,
      state.events.eventsByTick,
      state.events.eventsByType,
    );

    state.processedEventCount = live.liveEvents.length;

    // Create new references so downstream hooks detect the change.
    state.eventsByTick = { ...state.events.eventsByTick };
    state.eventsByType = { ...state.events.eventsByType };
    state.playerState = new Map(state.players.state);
    state.npcState = new Map(state.npcs.state);
  }

  const bcf = toBcf(
    challenge,
    stage,
    totalTicks,
    state.events.eventsByTick,
    state.events.eventsByType,
    state.players.state,
    state.npcs.state,
  );

  return {
    challenge,
    events: live.liveEvents,
    totalTicks,
    loading: false,
    isLive: true,
    isStreaming: live.isStreaming,
    eventsByTick: state.eventsByTick,
    eventsByType: state.eventsByType,
    playerState: state.playerState,
    npcState: state.npcState,
    bcf,
  };
}
