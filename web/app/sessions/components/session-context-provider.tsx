'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { SessionWithStats } from '@/actions/challenge';
import { SessionStatus } from '@blert/common';

interface SessionContext {
  isLoading: boolean;
  isInitialLoad: boolean;
  session: SessionWithStats | null;
  refetchSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContext>({
  isLoading: false,
  isInitialLoad: false,
  session: null,
  refetchSession: () => Promise.resolve(),
});

export const useSessionContext = () => useContext(SessionContext);

interface SessionContextProviderProps {
  uuid: string;
  initialData: SessionWithStats | null;
  children: React.ReactNode;
}

async function fetchSessionData(
  uuid: string,
): Promise<SessionWithStats | null> {
  try {
    const response = await fetch(`/api/v1/sessions/${uuid}`);
    const data = (await response.json()) as SessionWithStats;

    return {
      ...data,
      startTime: new Date(data.startTime),
      endTime: data.endTime ? new Date(data.endTime) : null,
      challenges: data.challenges.map((challenge) => ({
        ...challenge,
        startTime: new Date(challenge.startTime),
        finishTime: challenge.finishTime
          ? new Date(challenge.finishTime)
          : null,
      })),
    };
  } catch (error) {
    console.error('Failed to fetch session data:', error);
    return null;
  }
}

export default function SessionContextProvider({
  uuid,
  initialData = null,
  children,
}: SessionContextProviderProps) {
  const [sessionData, setSessionData] = useState<SessionWithStats | null>(
    initialData,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(!initialData);

  const refetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const newData = await fetchSessionData(uuid);
      if (newData) {
        setSessionData(newData);
      }
    } catch (error) {
      console.error('Failed to fetch session data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [uuid, setSessionData, setIsLoading]);

  useEffect(() => {
    if (initialData) {
      return;
    }

    const loadInitialData = async () => {
      const data = await fetchSessionData(uuid);
      setSessionData(data);
      setIsInitialLoad(false);
    };

    void loadInitialData();
  }, [uuid, initialData]);

  const isLive = sessionData?.status === SessionStatus.ACTIVE;

  useEffect(() => {
    if (isInitialLoad || !isLive) {
      return;
    }

    // Automatically refresh live sessions.
    const interval = setInterval(() => void refetchData(), 15_000);
    return () => clearInterval(interval);
  }, [refetchData, isInitialLoad, isLive]);

  const contextValue: SessionContext = {
    isLoading,
    isInitialLoad,
    session: sessionData,
    refetchSession: refetchData,
  };

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
}
