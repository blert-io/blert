'use client';

import { useCallback, useState } from 'react';

import { voteSetup, removeVote, type VoteType } from '@/actions/setup';
import VoteBar, { type VoteBarProps } from '@/components/vote-bar';
import { useToast } from '@/components/toast';

type SetupVoteBarProps = Omit<
  VoteBarProps,
  'likes' | 'dislikes' | 'currentVote'
> & {
  publicId: string;
  initialLikes: number;
  initialDislikes: number;
  initialVote: VoteType | null;
};

type VoteCounts = {
  likes: number;
  dislikes: number;
};

export default function SetupVoteBar({
  publicId,
  initialLikes,
  initialDislikes,
  initialVote,
  disabled = false,
  width,
}: SetupVoteBarProps) {
  const showToast = useToast();
  const [counts, setCounts] = useState<VoteCounts>({
    likes: initialLikes,
    dislikes: initialDislikes,
  });
  const [currentVote, setCurrentVote] = useState<VoteType | null>(initialVote);
  const [loading, setLoading] = useState(false);

  const handleVote = useCallback(
    async (voteType: VoteType) => {
      try {
        setLoading(true);
        const result = await voteSetup(publicId, voteType);
        if (result.error !== null) {
          throw new Error(result.error);
        }

        setCounts(result.counts!);
        setCurrentVote(voteType);
      } catch (e) {
        showToast((e as Error).message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [publicId, showToast, setCounts, setCurrentVote, setLoading],
  );

  const handleRemoveVote = useCallback(async () => {
    try {
      setLoading(true);
      const result = await removeVote(publicId);
      if (result.error !== null) {
        throw new Error(result.error);
      }

      setCounts(result.counts!);
      setCurrentVote(null);
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [publicId, showToast, setCounts, setCurrentVote, setLoading]);

  return (
    <VoteBar
      likes={counts.likes}
      dislikes={counts.dislikes}
      currentVote={currentVote}
      disabled={disabled}
      loading={loading}
      width={width}
      onVote={handleVote}
      onRemoveVote={handleRemoveVote}
    />
  );
}
