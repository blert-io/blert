'use client';

import { Challenge, Event, SplitType, Stage } from '@blert/common';
import {
  Dispatch,
  SetStateAction,
  createContext,
  useContext,
  useState,
} from 'react';

type ChallengeState = [
  Challenge | null,
  Dispatch<SetStateAction<Challenge | null>>,
];
export const ChallengeContext = createContext<ChallengeState>([
  null,
  () => {
    /* noop */
  },
]);

export default function ChallengeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const challengeState = useState<Challenge | null>(null);
  return (
    <ChallengeContext.Provider value={challengeState}>
      {children}
    </ChallengeContext.Provider>
  );
}

export type StageLocation = {
  stage: Stage;
  attempt: number | null;
};

export type LiveChallengeState = {
  /** Whether the challenge has an active live connection. */
  isLive: boolean;
  /** The stage currently being played in the live challenge. */
  currentStage: StageLocation | null;
  /** Whether the current stage is actively producing events. */
  isStreaming: boolean;
  /** True while catching up from a reset (between `reset` and `replay-end`). */
  replaying: boolean;
  /** Whether all recording clients have disconnected. */
  stalled: boolean;
  /** Accumulated events for the stage being streamed. */
  liveEvents: Event[];
  /** The latest tick received for the live stage, or `null` when none. */
  lastTick: number | null;
  /** In-fight splits detected from the live event stream. */
  liveSplits: Readonly<Partial<Record<SplitType, number>>>;
  /**
   * Request event streaming for a specific stage.
   * If `null`, only control messages are received.
   */
  setRequestedStage: (stage: Stage | null) => void;
};

export const DEFAULT_LIVE_STATE: LiveChallengeState = {
  isLive: false,
  currentStage: null,
  isStreaming: false,
  replaying: false,
  stalled: false,
  liveEvents: [],
  lastTick: null,
  liveSplits: {},
  setRequestedStage: () => {
    /* noop */
  },
};

export const LiveChallengeContext =
  createContext<LiveChallengeState>(DEFAULT_LIVE_STATE);

export function useLiveChallenge(): LiveChallengeState {
  return useContext(LiveChallengeContext);
}
