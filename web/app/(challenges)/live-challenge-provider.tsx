'use client';

import {
  Challenge,
  ChallengeStatus,
  Event,
  protoToJsonEvent,
  Stage,
} from '@blert/common';
import { EventStream } from '@blert/common/dist/generated/event_pb';
import {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useRouter } from 'next/navigation';

import {
  ChallengeContext,
  DEFAULT_LIVE_STATE,
  LiveChallengeContext,
  LiveChallengeState,
} from '@/challenge-context';
import { SplitTracker, getStageInfo } from '@/utils/boss-room-state';
import { challengeUrl, stagePath } from '@/utils/url';
import { useSetting } from '@/utils/user-settings';

const LIVE_SERVER_URL = process.env.NEXT_PUBLIC_LIVE_SERVER_URL;

type PendingRefresh = {
  predicate: (c: Challenge) => boolean;
  retriesLeft: number;
  nextDelay: number;
};

type LiveChallengeProviderProps = {
  onRefresh: () => void;
  children: ReactNode;
};

function decodeTicks(data: string): Event[] {
  const events = EventStream.deserializeBinary(
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
  );
  return events.getEventsList().map(protoToJsonEvent);
}

export default function LiveChallengeProvider({
  onRefresh,
  children,
}: LiveChallengeProviderProps) {
  const [challenge] = useContext(ChallengeContext) as [
    Challenge | null,
    unknown,
  ];

  const [state, setState] =
    useState<Omit<LiveChallengeState, 'setRequestedStage'>>(DEFAULT_LIVE_STATE);
  const [requestedStage, setRequestedStage] = useState<Stage | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState<PendingRefresh | null>(
    null,
  );
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const [autoNavigate] = useSetting({
    key: 'live-auto-navigate',
    defaultValue: false,
  });
  const router = useRouter();
  const connectionIdRef = useRef(0);
  const generationRef = useRef(0);
  const replayBufferRef = useRef<Event[]>([]);
  const shutdownTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const splitTrackerRef = useRef<SplitTracker>(null);
  splitTrackerRef.current ??= new SplitTracker();

  const challengeId = challenge?.uuid;
  const challengeStatus = challenge?.status;

  const connect = useCallback(
    (id: string, stage: Stage | null) => {
      const connectionId = ++connectionIdRef.current;
      let intentionalClose = false;

      const isStale = () => connectionIdRef.current !== connectionId;

      let url = `${LIVE_SERVER_URL}/challenges/${id}/live`;
      if (stage !== null) {
        url += `?stage=${stage}`;
      }
      const source = new EventSource(url);

      source.addEventListener('metadata', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const data = JSON.parse(e.data) as {
          stage: number;
          attempt: number | null;
          stageActive: boolean;
        };
        splitTrackerRef.current!.clear();
        setState({
          isLive: true,
          currentStage: { stage: data.stage as Stage, attempt: data.attempt },
          isStreaming: data.stageActive,
          replaying: false,
          stalled: false,
          liveEvents: [],
          lastTick: null,
          liveSplits: {},
        });
      });

      source.addEventListener('stage-change', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const data = JSON.parse(e.data) as {
          stage: number;
          attempt: number | null;
        };
        splitTrackerRef.current!.clear();
        setState({
          isLive: true,
          currentStage: { stage: data.stage as Stage, attempt: data.attempt },
          isStreaming: true,
          replaying: false,
          stalled: false,
          liveEvents: [],
          lastTick: null,
          liveSplits: {},
        });
      });

      source.addEventListener('stage-end', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const data = JSON.parse(e.data) as {
          stage: number;
          attempt: number | null;
        };
        setState((prev) => ({ ...prev, isStreaming: false }));
        onRefresh();
        setPendingRefresh({
          predicate: (c) =>
            getStageInfo(c, data.stage, data.attempt ?? undefined).ticks > 0,
          retriesLeft: 3,
          nextDelay: 1500,
        });
      });

      source.addEventListener('stalled', () => {
        if (isStale()) {
          return;
        }
        setState((prev) => ({ ...prev, stalled: true }));
      });

      source.addEventListener('complete', () => {
        if (isStale()) {
          return;
        }
        // Don't reset live state. Keep `isLive` true so that the bridging in
        // `useStageEvents` holds until the static data is fully available. When
        // the retry succeeds and challenge's status finalizes, the connection
        // effect resets state naturally.
        intentionalClose = true;
        source.close();
        // If stage-end already started a refresh, don't fire a duplicate.
        if (pendingRefreshRef.current === null) {
          onRefresh();
        }
        setPendingRefresh({
          predicate: (c) => c.status !== ChallengeStatus.IN_PROGRESS,
          retriesLeft: 3,
          nextDelay: 1000,
        });
      });

      source.addEventListener('shutdown', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const { retryWindow } = JSON.parse(e.data) as {
          retryWindow: number;
        };
        intentionalClose = true;
        source.close();
        const minDelay = Math.min(2000, retryWindow * 500);
        const delay =
          minDelay + Math.random() * (retryWindow * 1000 - minDelay);
        shutdownTimerRef.current = setTimeout(() => {
          if (isStale()) {
            return;
          }
          setReconnectTrigger((t) => t + 1);
        }, delay);
      });

      source.addEventListener('tick', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const data = JSON.parse(e.data) as {
          generation: number;
          tick: number;
          tickCount: number;
          data: string;
        };
        if (data.generation !== generationRef.current) {
          return;
        }
        const newEvents = decodeTicks(data.data);
        const splitsChanged = splitTrackerRef.current!.processEvents(newEvents);
        setState((prev) => ({
          ...prev,
          liveEvents: [...prev.liveEvents, ...newEvents],
          lastTick: data.tick + data.tickCount - 1,
          ...(splitsChanged && {
            liveSplits: { ...splitTrackerRef.current!.splits },
          }),
        }));
      });

      source.addEventListener('replay-chunk', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const data = JSON.parse(e.data) as {
          generation: number;
          startTick: number;
          tickCount: number;
          data: string;
        };
        if (data.generation !== generationRef.current) {
          return;
        }
        const events = decodeTicks(data.data);
        replayBufferRef.current.push(...events);
      });

      source.addEventListener('replay-end', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const data = JSON.parse(e.data) as {
          generation: number;
          tick: number | null;
        };
        if (data.generation !== generationRef.current) {
          return;
        }
        // Flush the entire replay buffer in one batch, jumping the view to the
        // current position.
        const buffered = replayBufferRef.current;
        replayBufferRef.current = [];
        splitTrackerRef.current!.rebuild(buffered);
        setState((prev) => ({
          ...prev,
          replaying: false,
          liveEvents: buffered,
          lastTick: data.tick,
          liveSplits: { ...splitTrackerRef.current!.splits },
        }));
      });

      source.addEventListener('reset', (e: MessageEvent<string>) => {
        if (isStale()) {
          return;
        }
        const data = JSON.parse(e.data) as {
          reason: string;
          stage: number;
          attempt: number | null;
          stageActive: boolean;
          generation: number;
        };
        generationRef.current = data.generation;
        replayBufferRef.current = [];
        splitTrackerRef.current!.clear();
        setState({
          isLive: true,
          currentStage: { stage: data.stage as Stage, attempt: data.attempt },
          isStreaming: data.stageActive,
          replaying: true,
          stalled: false,
          liveEvents: [],
          lastTick: null,
          liveSplits: {},
        });
      });

      source.onerror = () => {
        if (isStale() || intentionalClose) {
          return;
        }
        if (source.readyState === EventSource.CLOSED) {
          setState(DEFAULT_LIVE_STATE);
        }
      };

      return source;
    },
    [onRefresh],
  );

  useEffect(() => {
    if (
      !LIVE_SERVER_URL ||
      challengeId === undefined ||
      challengeStatus !== ChallengeStatus.IN_PROGRESS
    ) {
      setState(DEFAULT_LIVE_STATE);
      return;
    }

    const source = connect(challengeId, requestedStage);

    return () => {
      source.close();
      clearTimeout(shutdownTimerRef.current);
    };
  }, [challengeId, challengeStatus, connect, requestedStage, reconnectTrigger]);

  const pendingRefreshRef = useRef(pendingRefresh);
  pendingRefreshRef.current = pendingRefresh;

  // Check the refresh predicate whenever the challenge context updates.
  useEffect(() => {
    const pending = pendingRefreshRef.current;
    if (pending === null || challenge === null) {
      return;
    }
    if (pending.predicate(challenge)) {
      setPendingRefresh(null);
    }
  }, [challenge]);

  // Auto-navigate to the live stage when the setting is enabled.
  const baseUrl =
    challenge !== null ? challengeUrl(challenge.type, challenge.uuid) : null;
  const liveStage = state.currentStage?.stage ?? null;
  const liveAttempt = state.currentStage?.attempt ?? undefined;
  useEffect(() => {
    if (
      autoNavigate &&
      state.isStreaming &&
      liveStage !== null &&
      baseUrl !== null
    ) {
      const url = `${baseUrl}/${stagePath(liveStage, liveAttempt)}`;
      router.push(url);
    }
  }, [
    autoNavigate,
    state.isStreaming,
    liveStage,
    liveAttempt,
    baseUrl,
    router,
  ]);

  // Schedule refresh retries.
  useEffect(() => {
    if (pendingRefresh === null || pendingRefresh.retriesLeft <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      onRefresh();
      setPendingRefresh((prev) =>
        prev !== null
          ? {
              ...prev,
              retriesLeft: prev.retriesLeft - 1,
              nextDelay: prev.nextDelay * 2,
            }
          : null,
      );
    }, pendingRefresh.nextDelay);

    return () => clearTimeout(timer);
  }, [pendingRefresh, onRefresh]);

  const contextValue: LiveChallengeState = useMemo(
    () => ({ ...state, setRequestedStage }),
    [state],
  );

  return (
    <LiveChallengeContext.Provider value={contextValue}>
      {children}
    </LiveChallengeContext.Provider>
  );
}
