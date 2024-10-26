'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useContext, useEffect, useRef, useState } from 'react';

import Spinner from '@/components/spinner';
import PlayerSearch from '@/components/player-search';
import { DisplayContext } from '@/display';

import styles from './styles.module.scss';

export default function NavPlayerSearch() {
  const display = useContext(DisplayContext);
  const router = useRouter();
  const pathname = usePathname();

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(false);
  }, [pathname]);

  const playerSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (e: KeyboardEvent) => {
      if (e.key === 'k' && e.ctrlKey) {
        e.preventDefault();
        playerSearchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const customIcon = loading ? (
    <Spinner />
  ) : display.isFull() ? (
    <div className={styles.shortcut}>
      <span>Ctrl</span>-<span>K</span>
    </div>
  ) : undefined;

  return (
    <PlayerSearch
      customIcon={customIcon}
      disabled={loading}
      faIcon={display.isCompact() ? 'fa-solid fa-search' : undefined}
      fluid
      id="blert-player-search"
      label="Find a player"
      labelBg="var(--nav-bg)"
      maxLength={12}
      onChange={(value) => {
        setUsername(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
      }}
      onSelection={(username) => {
        const playerPath = `/players/${encodeURIComponent(username)}`;
        if (pathname !== playerPath) {
          router.push(playerPath);
          setLoading(true);
        }
        setUsername('');
        playerSearchRef.current?.blur();
      }}
      ref={playerSearchRef}
      value={username}
    />
  );
}
