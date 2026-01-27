'use client';

import { MouseEvent, useState } from 'react';

import { FollowedPlayer, SuggestedPlayer } from '@/actions/feed';
import PlayerAvatar from '@/components/player-avatar';
import PlayerLink from '@/components/player-link';
import { useToast } from '@/components/toast';

import styles from './player-picker.module.scss';

type PlayerPickerProps = {
  suggestions: SuggestedPlayer[];
  onComplete: (followedPlayers: FollowedPlayer[]) => void;
};

export default function PlayerPicker({
  suggestions,
  onComplete,
}: PlayerPickerProps) {
  const showToast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const togglePlayer = (playerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  };

  const handleFollowSelected = async () => {
    if (selected.size === 0) {
      onComplete([]);
      return;
    }

    setIsSubmitting(true);

    const selectedPlayers = suggestions.filter((p) => selected.has(p.id));
    const usernames = selectedPlayers.map((p) => p.username);

    try {
      const response = await fetch('/api/following', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames }),
      });

      if (!response.ok) {
        showToast('Failed to follow players', 'error');
        onComplete([]);
        return;
      }

      const results = (await response.json()) as (FollowedPlayer | null)[];
      const followedPlayers = results.filter(
        (r): r is FollowedPlayer => r !== null,
      );

      if (followedPlayers.length > 0) {
        showToast(
          `Now following ${followedPlayers.length} player${followedPlayers.length > 1 ? 's' : ''}`,
          'success',
        );
      }

      if (followedPlayers.length < selected.size) {
        showToast('Some players could not be followed', 'error');
      }

      onComplete(followedPlayers);
    } catch {
      showToast('Failed to follow players', 'error');
      onComplete([]);
    }
  };

  const handleSkip = () => {
    onComplete([]);
  };

  return (
    <div className={styles.playerPicker}>
      <div className={styles.header}>
        <h3>Players You Might Like</h3>
        <p>Select players to follow and populate your feed</p>
      </div>

      <div className={styles.grid}>
        {suggestions.map((player) => {
          const isSelected = selected.has(player.id);
          return (
            <button
              key={player.id}
              className={`${styles.playerCard} ${isSelected ? styles.selected : ''}`}
              onClick={() => togglePlayer(player.id)}
              disabled={isSubmitting}
            >
              <div className={styles.checkbox}>
                {isSelected && <i className="fas fa-check" />}
              </div>
              <PlayerAvatar
                id={player.id}
                username={player.username}
                size="large"
              />
              <div className={styles.playerInfo}>
                <PlayerLink
                  username={player.username}
                  className={styles.playerName}
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                >
                  {player.username}
                </PlayerLink>
                <span className={styles.playerStat}>
                  {player.totalChallenges} challenge
                  {player.totalChallenges !== 1 ? 's' : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className={styles.actions}>
        <button
          className={styles.followButton}
          onClick={() => void handleFollowSelected()}
          disabled={isSubmitting || selected.size === 0}
        >
          {isSubmitting ? (
            <>
              <i className="fas fa-spinner fa-spin" />
              Following...
            </>
          ) : (
            <>
              <i className="fas fa-user-plus" />
              Follow {selected.size} Player{selected.size !== 1 ? 's' : ''} &
              Continue
            </>
          )}
        </button>
        <button
          className={styles.skipButton}
          onClick={handleSkip}
          disabled={isSubmitting}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
