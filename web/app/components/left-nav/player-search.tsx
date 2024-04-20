'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import Input from '@/components/input';

export default function PlayerSearch() {
  const router = useRouter();

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

  return (
    <Input
      faIcon="fa-solid fa-magnifying-glass"
      fluid
      id="blert-player-search"
      inputRef={playerSearchRef}
      label="Search for a player"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          router.push(`/players/${e.currentTarget.value}`);
          e.currentTarget.value = '';
          e.currentTarget.blur();
        }
      }}
      type="text"
    />
  );
}
