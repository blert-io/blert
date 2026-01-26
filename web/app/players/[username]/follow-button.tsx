'use client';

import { useState } from 'react';

import { followPlayer, unfollowPlayer } from '@/actions/feed';
import { useToast } from '@/components/toast';

import styles from './style.module.scss';

type FollowButtonProps = {
  playerId: number;
  username: string;
  isFollowing: boolean;
  isSignedIn: boolean;
};

export default function FollowButton({
  playerId,
  username,
  isFollowing: initialIsFollowing,
  isSignedIn,
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isLoading, setIsLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const showToast = useToast();

  if (!isSignedIn) {
    return null;
  }

  const handleClick = async () => {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    const previousState = isFollowing;

    setIsFollowing(!isFollowing);

    try {
      if (previousState) {
        await unfollowPlayer(playerId);
      } else {
        await followPlayer(username);
      }
    } catch {
      setIsFollowing(previousState);
      showToast('Failed to update follow status. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const getButtonContent = () => {
    if (isLoading) {
      return <i className="fas fa-spinner fa-spin" />;
    }

    if (isFollowing) {
      if (isHovered) {
        return (
          <>
            <i className="fas fa-user-minus" />
            <span>Unfollow</span>
          </>
        );
      }
      return (
        <>
          <i className="fas fa-user-check" />
          <span>Following</span>
        </>
      );
    }

    return (
      <>
        <i className="fas fa-user-plus" />
        <span>Follow</span>
      </>
    );
  };

  return (
    <button
      className={`${styles.followButton} ${isFollowing ? styles.following : ''}`}
      onClick={() => void handleClick()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={isLoading}
    >
      {getButtonContent()}
    </button>
  );
}
