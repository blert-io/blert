'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import Input from '@/components/input';
import Spinner from '@/components/spinner';

import styles from './styles.module.scss';

export default function PlayerSearch() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => setLoading(false), [pathname]);

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
  ) : (
    <div className={styles.shortcut}>
      <span>Ctrl</span>-<span>K</span>
    </div>
  );

  return (
    <Input
      customIcon={customIcon}
      disabled={loading}
      fluid
      id="blert-player-search"
      inputRef={playerSearchRef}
      label="Search players"
      labelBg="var(--nav-bg)"
      maxLength={12}
      onChange={(e) => setUsername(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          router.push(`/players/${username}`);
          setLoading(true);
          setUsername('');
          e.currentTarget.blur();
        }
      }}
      value={username}
      type="text"
    />
  );
}
