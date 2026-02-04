'use client';

import { ChallengeType } from '@blert/common';
import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { ChallengeContext } from '@/challenge-context';
import ChallengeLoadError from '@/components/challenge-load-error';
import Loading from '@/components/loading';
import { challengeLogo } from '@/logo';
import { challengeTerm } from '@/utils/challenge';
import { notFound, usePathname } from 'next/navigation';

type ChallengeProviderProps = {
  children: ReactNode;
  challengeId: string;
};

type ChallengeProviderOptions<TChallenge> = {
  buildUrl: (id: string) => string;
  challengeType: ChallengeType;
  parse?: (payload: unknown) => TChallenge;
  errorMessage?: string;
  errorDetails?: string;
};

export const ActorContext = createContext<RoomActorState>({
  selectedActor: null,
  setSelectedActor: missingActorDispatch,
});

type ChallengeProviderResult = {
  ActorContext: typeof ActorContext;
  ChallengeProvider: (props: ChallengeProviderProps) => ReactNode;
};

export type SelectedActor =
  | { type: 'player'; name: string }
  | { type: 'npc'; roomId: number };

type RoomActorState = {
  selectedActor: SelectedActor | null;
  setSelectedActor: Dispatch<SetStateAction<SelectedActor | null>>;
};

function missingActorDispatch(): never {
  throw new Error('setSelectedActor must be used within an ActorContext');
}

export function createChallengeContextProvider<TChallenge>(
  options: ChallengeProviderOptions<TChallenge>,
): ChallengeProviderResult {
  const {
    buildUrl,
    challengeType,
    parse = (payload: unknown) => payload as TChallenge,
    errorMessage,
    errorDetails = 'Please refresh in a few seconds.',
  } = options;

  const challengeName = challengeTerm(challengeType);
  const challengeNameLower = challengeName.toLowerCase();
  const resolvedErrorMessage =
    errorMessage ?? `Unable to load this ${challengeNameLower} right now.`;
  const logoSrc = challengeLogo(challengeType);

  function ChallengeProvider({
    children,
    challengeId,
  }: ChallengeProviderProps) {
    const pathname = usePathname();

    const [challenge, setChallenge] = useContext(ChallengeContext) as [
      TChallenge | null,
      Dispatch<SetStateAction<TChallenge | null>>,
    ];

    const [selectedActor, setSelectedActor] = useState<SelectedActor | null>(
      null,
    );
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const challengeIdRef = useRef(challengeId);

    const challengeLoaded = challenge !== null;

    useEffect(() => {
      let isActive = true;

      const loadChallenge = async () => {
        setLoading(!challengeLoaded || challengeIdRef.current !== challengeId);
        setLoadError(null);

        try {
          const response = await fetch(buildUrl(challengeId));
          if (response.status === 404) {
            if (isActive) {
              setChallenge(null);
            }
            return;
          }

          if (!response.ok) {
            throw new Error(`fetch failed with status ${response.status}`);
          }

          const payload = (await response.json()) as unknown;
          if (isActive) {
            setChallenge(parse(payload));
          }
        } catch (error) {
          if (!isActive) {
            return;
          }
          console.warn(
            `Failed to load ${challengeNameLower} ${challengeId}`,
            error,
          );
          setChallenge(null);
          setLoadError(resolvedErrorMessage);
        } finally {
          if (!isActive) {
            return;
          }
          setLoading(false);
          challengeIdRef.current = challengeId;
        }
      };

      void loadChallenge();

      // Reload when navigating between nested routes (e.g., overview/bosses)
      // to keep in-progress challenges fresh.
      return () => {
        isActive = false;
      };
    }, [challengeLoaded, challengeId, pathname, setChallenge]);

    useEffect(() => {
      return () => {
        setChallenge(null);
      };
    }, [setChallenge]);

    if (loading) {
      return <Loading />;
    }

    if (loadError) {
      return (
        <ChallengeLoadError
          message={loadError}
          details={errorDetails}
          logoSrc={logoSrc}
          logoAlt={`${challengeName} logo`}
        />
      );
    }

    if (challenge === null) {
      return notFound();
    }

    return (
      <ActorContext.Provider
        value={{
          selectedActor,
          setSelectedActor,
        }}
      >
        {children}
      </ActorContext.Provider>
    );
  }

  return { ActorContext, ChallengeProvider };
}

export type { RoomActorState };
